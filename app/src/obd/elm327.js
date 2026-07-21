// elm327.js — ELM327 command protocol, transport-agnostic.
//
// The adapter is a line-oriented modem: you write "010C\r" and it streams back
// characters ending in "\r\r>". Everything here is pure string/byte work so it
// runs unchanged in Node for the test file — the BLE layer just supplies
// { write, subscribe }.
//
// Commands are strictly serialized. ELM327 has no request IDs, so two in
// flight at once is unrecoverable ambiguity.

import { decodeDtcBytes, explainDtc } from './dtc.js';
import { decodePid, decodeStatus, PIDS } from './pids.js';
import {
  SERVICE, buildRequest, parseUdsResponse, parseDtcsByStatusMask,
  responseIdFor, CANDIDATE_MODULES,
} from './uds.js';

const PROMPT = '>';

// ELM327 error strings. Some are recoverable (retry), some mean the car isn't
// talking to us at all.
const ERRORS = [
  'NO DATA',
  'UNABLE TO CONNECT',
  'BUS INIT',
  'BUS ERROR',
  'CAN ERROR',
  'DATA ERROR',
  'BUFFER FULL',
  'STOPPED',
  'ERROR',
  '?',
];

export class ObdError extends Error {
  constructor(message, raw) {
    super(message);
    this.name = 'ObdError';
    this.raw = raw;
  }
}

/**
 * Strip an ELM327 reply down to the hex payload bytes.
 *
 * Handles the two shapes a CAN response arrives in when headers are off:
 *
 *   single frame:  "4105 7B"          -> [0x41, 0x05, 0x7B]
 *   multi frame:   "014"              <- total byte count, discard
 *                  "0:490201314A34"   <- line-numbered segments
 *                  "1:41313142383..."
 *
 * Returns [] when the adapter reported an error rather than data.
 */
export function parseHexResponse(raw) {
  const lines = raw
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => l !== PROMPT);

  const segments = [];
  let sawSegmented = false;

  for (const line of lines) {
    const upper = line.toUpperCase();
    if (ERRORS.some((e) => upper.includes(e))) return [];
    if (upper === 'SEARCHING...' || upper === 'OK') continue;

    const seg = upper.match(/^([0-9A-F]+)\s*:\s*(.*)$/);
    if (seg) {
      sawSegmented = true;
      segments.push(seg[2]);
      continue;
    }
    segments.push(upper);
  }

  // In a segmented reply the adapter prints the ISO-TP total byte count on its
  // own line before the first "0:" segment. Drop it — it isn't data.
  if (sawSegmented && /^[0-9A-F]{1,3}$/.test(segments[0] || '')) {
    segments.shift();
  }

  const hex = segments.join('').replace(/[^0-9A-F]/g, '');
  const bytes = [];
  for (let i = 0; i + 1 < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

/**
 * Pull DTCs out of a Mode 03 / 07 / 0A response.
 *
 * On CAN the byte after the 0x43 echo is a code count, and the frame is then
 * zero-padded out to 8 bytes — so you must trust the count and stop there
 * rather than reading to the end of the buffer.
 *
 * ponytail: assumes the CAN count byte is present, which is right for any
 * US vehicle from 2008 on (a 2011 Range Rover included). Ceiling: the older
 * K-line protocols omit that byte and would misparse. Upgrade path: init()
 * already reads ATDPN — pass the protocol number in and skip the slice when
 * it's 1-5.
 */
export function parseDtcResponse(bytes, mode = 0x43) {
  let body = bytes.slice();

  const echo = body.indexOf(mode);
  if (echo === -1) return [];
  body = body.slice(echo + 1);

  // Take exactly `count` codes; the rest of the frame is padding. If the count
  // is implausible, fall through and read the whole body as pairs.
  const count = body[0];
  if (body.length && count * 2 <= body.length - 1) {
    body = body.slice(1, 1 + count * 2);
  }

  const codes = [];
  for (let i = 0; i + 1 < body.length; i += 2) {
    const code = decodeDtcBytes(body[i], body[i + 1]);
    if (code && !codes.includes(code)) codes.push(code);
  }
  return codes;
}

/** Mode 09 PID 02 — VIN comes back as 17 ASCII bytes after a 3-byte header. */
export function parseVin(bytes) {
  const echo = bytes.indexOf(0x49);
  if (echo === -1) return null;
  // 49 02 01 <17 chars>
  const chars = bytes.slice(echo + 3).filter((b) => b >= 0x20 && b <= 0x7e);
  const vin = String.fromCharCode(...chars).trim();
  return vin.length >= 17 ? vin.slice(0, 17) : (vin || null);
}

export class Elm327 {
  /**
   * @param {{ write:(s:string)=>Promise<void>, subscribe:(cb:(chunk:string)=>void)=>()=>void }} transport
   */
  constructor(transport, { log } = {}) {
    this.transport = transport;
    this.log = log || (() => {});
    this.buffer = '';
    this.pending = null;
    this.queue = Promise.resolve();
    this.unsubscribe = transport.subscribe((chunk) => this._onChunk(chunk));
  }

  _onChunk(chunk) {
    this.buffer += chunk;
    if (!this.pending) return;
    if (this.buffer.includes(PROMPT)) {
      const idx = this.buffer.indexOf(PROMPT);
      const raw = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      const { resolve, timer } = this.pending;
      this.pending = null;
      clearTimeout(timer);
      resolve(raw);
    }
  }

  /** Send one command, resolve with the raw text before the '>' prompt. */
  send(command, timeoutMs = 5000) {
    const run = async () => {
      // Anything left over from a timed-out command would corrupt this reply.
      this.buffer = '';
      const raw = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pending = null;
          reject(new ObdError(`Timed out waiting for "${command}"`, command));
        }, timeoutMs);
        this.pending = { resolve, timer };
        this.transport.write(command + '\r').catch((e) => {
          clearTimeout(timer);
          this.pending = null;
          reject(e);
        });
      });
      this.log(`> ${command}\n< ${raw.trim()}`);
      return raw;
    };

    // Chain onto the queue so only one command is ever in flight, and make
    // sure a failure doesn't poison the chain for later commands.
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => {});
    return result;
  }

  async sendBytes(command, timeoutMs = 5000) {
    return parseHexResponse(await this.send(command, timeoutMs));
  }

  /**
   * Bring the adapter up and get it talking to the car.
   * Echo and whitespace off so replies are compact; headers off so the
   * adapter does ISO-TP reassembly for us; protocol auto so we don't have to
   * know that a 2011 Range Rover is 11-bit 500k CAN (it is).
   *
   * ponytail: ATH0 (headers off) means we can't tell which module answered.
   * Ceiling: if two ECUs both reply to Mode 03, their frames concatenate and
   * codes may appear duplicated or garbled. In practice only the engine module
   * answers the legislated modes, so this is fine. Upgrade path: ATH1, then
   * group response lines by their leading CAN ID before decoding.
   */
  async init() {
    await this.send('ATZ', 10000);      // full reset, slowest command
    await this.send('ATE0');            // echo off
    await this.send('ATL0');            // no linefeeds
    await this.send('ATS0');            // no spaces in responses
    await this.send('ATH0');            // headers off
    await this.send('ATSP0', 10000);    // auto-detect protocol

    // First real request forces protocol negotiation; it can be slow and it
    // can legitimately fail once while the bus wakes up.
    let supported = await this.sendBytes('0100', 15000);
    if (!supported.length) supported = await this.sendBytes('0100', 15000);
    if (!supported.length) {
      throw new ObdError(
        'Adapter is connected but the car is not responding. Check the ignition is in position II (or the engine is running) and the adapter is fully seated.',
      );
    }

    const protocol = (await this.send('ATDPN')).trim().replace(/[^0-9A-Fa-f]/g, '');
    return { protocol, supportedRaw: supported };
  }

  /** Mode 01 PID 01 — MIL, code count, readiness monitors. */
  async readStatus() {
    return decodeStatus(await this.sendBytes('0101'));
  }

  async readVin() {
    try {
      return parseVin(await this.sendBytes('0902', 8000));
    } catch {
      return null;
    }
  }

  /** Stored, pending and permanent codes, each explained. */
  async readCodes() {
    const stored = parseDtcResponse(await this.sendBytes('03', 8000), 0x43);
    const pending = parseDtcResponse(await this.sendBytes('07', 8000), 0x47);
    let permanent = [];
    try {
      permanent = parseDtcResponse(await this.sendBytes('0A', 8000), 0x4a);
    } catch {
      // Mode 0A is optional and plenty of ECUs just don't answer.
    }
    return {
      stored: stored.map(explainDtc),
      pending: pending.map(explainDtc),
      permanent: permanent.map(explainDtc),
    };
  }

  /**
   * Mode 04 — clear codes and turn off the check engine light.
   * This also wipes the readiness monitors, which is why the UI warns first.
   */
  async clearCodes() {
    const raw = await this.send('04', 8000);
    if (/ERROR|UNABLE|NO DATA/i.test(raw)) {
      throw new ObdError('The ECU refused the clear request. Try again with the engine off and ignition on.', raw);
    }
    return true;
  }

  /** Read one live PID. Returns null if the car doesn't support it. */
  async readPid(pid) {
    const bytes = await this.sendBytes('01' + pid, 3000);
    return decodePid(pid, bytes);
  }

  /**
   * Ask the ECU which Mode 01 PIDs it supports, so the Live screen only polls
   * things this car actually answers instead of burning a slow BLE round trip
   * on every PID to find out.
   */
  async readSupportedPids() {
    const supported = new Set();
    // 0100 covers 01-20, 0120 covers 21-40, 0140 covers 41-60.
    for (const [base, cmd] of [[0x00, '0100'], [0x20, '0120'], [0x40, '0140']]) {
      const bytes = await this.sendBytes(cmd, 5000);
      if (bytes.length < 6) break;
      const mask = bytes.slice(2, 6);
      for (let i = 0; i < 32; i++) {
        const byte = mask[i >> 3];
        if (byte & (0x80 >> (i & 7))) {
          supported.add((base + i + 1).toString(16).toUpperCase().padStart(2, '0'));
        }
      }
      // The top bit of the last byte means "the next range is also supported".
      if (!(mask[3] & 0x01)) break;
    }
    return [...supported].filter((p) => PIDS[p]);
  }

  // --- UDS: talking to modules that aren't the engine ----------------------
  //
  // Generic OBD-II broadcasts to 0x7DF and whoever answers, answers. To reach
  // the ABS module you have to address it directly, which means three things
  // the adapter does not do by default:
  //   ATSH   set the transmit header to the module's request ID
  //   ATCRA  filter receive to that module's response ID, so other chatter on
  //          a live bus doesn't get spliced into the reply
  //   ATFC*  supply ISO-TP flow control, because with a custom header the
  //          adapter no longer auto-generates it and multi-frame replies
  //          (which is most DTC lists) simply stall without it

  /**
   * Point the adapter at one module. Pass null to go back to broadcast.
   *
   * `fast` skips flow-control setup: a discovery probe only ever expects a
   * single-frame reply, so those three commands are pure latency. Across a
   * 240-address sweep that is ~700 wasted BLE round trips.
   */
  async targetModule(reqId, { fast = false } = {}) {
    if (reqId === null) {
      await this.send('ATAR');       // restore automatic receive address
      await this.send('ATSH7DF');    // OBD-II functional broadcast
      await this.send('ATFCSM0');    // adapter handles flow control again
      this.target = null;
      return;
    }
    const req = reqId.toString(16).toUpperCase().padStart(3, '0');
    const res = responseIdFor(reqId).toString(16).toUpperCase().padStart(3, '0');

    await this.send('ATSH' + req);
    await this.send('ATCRA' + res);
    if (!fast) {
      await this.send('ATFCSH' + req);
      await this.send('ATFCSD300000');  // block size 0, no separation time
      await this.send('ATFCSM1');       // use the flow control we just defined
    }
    this.target = reqId;
  }

  /**
   * Send a UDS request to the currently targeted module.
   * Transparently waits out 0x78 "response pending", which modules use when a
   * request takes longer than the protocol timeout — treating it as a failure
   * is the classic reason a scan tool "can't see" a module that is right there.
   */
  async udsRequest(service, params = [], { timeoutMs = 4000, maxPending = 4 } = {}) {
    const request = buildRequest(service, ...params);
    let bytes = await this.sendBytes(request, timeoutMs);
    let parsed = parseUdsResponse(bytes, service);

    // Most adapters absorb 0x78 themselves; this covers the ones that don't.
    for (let i = 0; parsed.kind === 'pending' && i < maxPending; i++) {
      bytes = await this.sendBytes(request, timeoutMs);
      parsed = parseUdsResponse(bytes, service);
    }
    return { parsed, bytes };
  }

  /**
   * Probe one CAN ID to see whether a module lives there.
   * TesterPresent is the right knock: every UDS module implements it, it
   * changes nothing, and even a *negative* reply proves something is home.
   */
  async probeModule(reqId, timeoutMs = 1200) {
    await this.targetModule(reqId, { fast: true });
    try {
      const { parsed } = await this.udsRequest(SERVICE.TESTER_PRESENT, [0x00], {
        timeoutMs, maxPending: 1,
      });
      // Anything other than silence means a module answered. A *negative*
      // reply still proves presence — it refused, so it's listening.
      return parsed.kind === 'positive' || parsed.kind === 'negative';
    } catch {
      return false;
    }
  }

  /**
   * Sweep candidate addresses and report which ones are actually populated.
   * This is the discovery step that replaces guessing at a module table.
   *
   * `signal` lets the UI abort a long sweep — a full-range scan is minutes,
   * and being unable to stop it from the passenger seat is its own bug.
   */
  async discoverModules(candidates = CANDIDATE_MODULES, onProgress, signal) {
    const found = [];
    // Shorten the adapter's per-request patience: an empty address is decided
    // by timeout, and the default wait dominates the sweep.
    const restoreTimeout = async () => { await this.send('ATST64').catch(() => {}); };
    await this.send('ATST20').catch(() => {});   // 0x20 * 4ms = ~128ms

    try {
      for (let i = 0; i < candidates.length; i++) {
        if (signal?.aborted) break;
        const c = candidates[i];
        const present = await this.probeModule(c.req, 2000);
        onProgress?.({ index: i, total: candidates.length, module: c, present });
        if (present) found.push(c);
      }
    } finally {
      await restoreTimeout();
      await this.targetModule(null).catch(() => {});
    }
    return found;
  }

  /**
   * Read stored DTCs from one module via UDS service 0x19.
   * Mask 0xFF asks for everything the module has rather than only confirmed
   * faults — on a 15-year-old truck the pending and historic ones matter too.
   */
  async readModuleDtcs(reqId, statusMask = 0xff) {
    await this.targetModule(reqId);
    const { bytes } = await this.udsRequest(SERVICE.READ_DTC_INFORMATION, [0x02, statusMask]);
    return parseDtcsByStatusMask(bytes);
  }

  close() {
    if (this.unsubscribe) this.unsubscribe();
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending = null;
    }
  }
}
