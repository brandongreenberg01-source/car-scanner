// uds.js — Unified Diagnostic Services (ISO 14229), the protocol the factory
// tool speaks.
//
// Generic OBD-II (mode 01/03) is the emissions subset every car must expose.
// UDS is the real diagnostic layer: it reaches ABS, transmission, restraints,
// body modules — anything on the bus — but only if you address the module
// directly by its CAN ID instead of broadcasting.
//
// Nothing here is JLR-proprietary. It's the open standard; the proprietary
// part is knowing which CAN IDs the modules sit on, which is why this file
// pairs with a discovery sweep rather than a hardcoded table we'd be guessing
// at.

// --- Negative response codes ------------------------------------------------
// A module that refuses tells you *why*, and the reason is diagnostic gold:
// 0x11 means "I don't do this service", 0x33 means "I do, but you're not
// authorised" — very different conclusions about what's possible.
export const NRC = {
  0x10: 'General reject',
  0x11: 'Service not supported',
  0x12: 'Sub-function not supported',
  0x13: 'Incorrect message length',
  0x14: 'Response too long',
  0x21: 'Busy, repeat request',
  0x22: 'Conditions not correct',
  0x24: 'Request sequence error',
  0x31: 'Request out of range',
  0x33: 'Security access denied',
  0x35: 'Invalid key',
  0x36: 'Exceeded number of attempts',
  0x37: 'Required time delay not expired',
  0x78: 'Response pending',
  0x7E: 'Sub-function not supported in active session',
  0x7F: 'Service not supported in active session',
};

// Services we actually use. Read-only by design — see WRITE_SERVICES below.
export const SERVICE = {
  DIAGNOSTIC_SESSION_CONTROL: 0x10,
  ECU_RESET: 0x11,
  CLEAR_DIAGNOSTIC_INFORMATION: 0x14,
  READ_DTC_INFORMATION: 0x19,
  READ_DATA_BY_IDENTIFIER: 0x22,
  SECURITY_ACCESS: 0x27,
  TESTER_PRESENT: 0x3E,
};

// ponytail: this app is read-only on purpose. Writing to an L322 module can
// brick it, and some bricked modules are immobilising. These are listed so the
// intent is explicit and so a future contributor has to consciously opt in.
export const WRITE_SERVICES = new Set([0x2e, 0x2f, 0x31, 0x34, 0x35, 0x36, 0x37]);

/**
 * Candidate diagnostic CAN IDs to probe.
 *
 * The 2010-2012 L322 uses a Ford/Jaguar-derived electrical architecture, so
 * Ford's diagnostic addressing is the best available starting guess. These are
 * CANDIDATES, not facts — the discovery sweep is what establishes truth, and
 * anything it doesn't answer on simply isn't there.
 *
 * Ford convention: response ID = request ID + 8.
 */
export const CANDIDATE_MODULES = [
  { req: 0x7e0, name: 'Engine (ECM/PCM)' },
  { req: 0x7e1, name: 'Transmission (TCM)' },
  { req: 0x7e2, name: 'Powertrain #3' },
  { req: 0x760, name: 'ABS / Stability control' },
  { req: 0x765, name: 'Power steering' },
  { req: 0x720, name: 'Instrument cluster' },
  { req: 0x726, name: 'Body control / Central junction box' },
  { req: 0x727, name: 'Body #2' },
  { req: 0x730, name: 'Climate control' },
  { req: 0x733, name: 'Restraints (airbag)' },
  { req: 0x736, name: 'Parking aid' },
  { req: 0x737, name: 'Electronic parking brake' },
  { req: 0x740, name: 'Driver door module' },
  { req: 0x741, name: 'Passenger door module' },
  { req: 0x744, name: 'Transfer case' },
  { req: 0x750, name: 'Steering angle sensor' },
  { req: 0x7a0, name: 'Suspension / ride control' },
  { req: 0x706, name: 'Auxiliary #706' },
  { req: 0x716, name: 'Auxiliary #716' },
  { req: 0x770, name: 'Auxiliary #770' },
];

/** Ford/JLR convention: a module answers 8 above its request address. */
export const responseIdFor = (reqId) => reqId + 8;

/**
 * Every 11-bit ID in the conventional diagnostic block, named where we have a
 * guess and labelled honestly where we don't.
 *
 * This is the difference between checking 20 addresses someone else's cars use
 * and actually mapping what is on THIS truck. A module sitting at an address
 * absent from CANDIDATE_MODULES is invisible to the quick sweep and shows up
 * here — which is the whole point when no public JLR address table exists.
 *
 * ponytail: 0x700-0x7FF only. Ceiling: 11-bit IDs outside that block, and
 * 29-bit extended addressing, are not probed. Upgrade path is widening the
 * range, at proportional time cost.
 */
export function fullSweepCandidates() {
  const named = new Map(CANDIDATE_MODULES.map((m) => [m.req, m.name]));
  const out = [];
  for (let id = 0x700; id <= 0x7ff; id++) {
    // 7E8-7EF are response addresses for 7E0-7E7, never request addresses.
    if (id >= 0x7e8 && id <= 0x7ef) continue;
    out.push({
      req: id,
      name: named.get(id) || `Unknown 0x${id.toString(16).toUpperCase()}`,
      known: named.has(id),
    });
  }
  return out;
}

const hex = (n, width = 2) => n.toString(16).toUpperCase().padStart(width, '0');

/** Build the hex string for a UDS request, e.g. readDtcs() -> "1902FF". */
export const buildRequest = (service, ...params) =>
  hex(service) + params.map((p) => hex(p)).join('');

/**
 * Classify a raw UDS response.
 * Returns { kind: 'positive'|'negative'|'pending'|'empty', ... }
 *
 * 0x78 (response pending) is called out separately because it is not a
 * failure — the module is asking for more time and the caller must wait
 * rather than give up.
 */
export function parseUdsResponse(bytes, requestedService) {
  if (!bytes || bytes.length === 0) return { kind: 'empty' };

  // Check for a positive response FIRST. Most ELM327 firmwares wait out a
  // 0x78 "pending" internally and hand back both frames concatenated, so a
  // buffer can legitimately contain the negative *and* the real answer. Seeing
  // the 0x7F first and bailing is why a module that replied looks like it
  // didn't. A positive response echoes the service with bit 6 set (+0x40).
  const expected = requestedService + 0x40;
  const start = bytes.indexOf(expected);
  if (start !== -1) {
    return { kind: 'positive', service: expected, data: bytes.slice(start + 1) };
  }

  const neg = bytes.indexOf(0x7f);
  if (neg !== -1 && bytes.length >= neg + 3) {
    const code = bytes[neg + 2];
    if (code === 0x78) return { kind: 'pending', code, message: NRC[code] };
    return { kind: 'negative', code, message: NRC[code] || `Unknown NRC 0x${hex(code)}` };
  }

  return { kind: 'empty' };
}

// --- DTC decoding -----------------------------------------------------------
// UDS reports 3-byte DTCs plus a status byte, unlike OBD-II's 2 bytes. The
// first two bytes use the same bit layout; the third is the failure type,
// which is what turns "P0301" into "P0301-11 short to ground".

const SYSTEMS = ['P', 'C', 'B', 'U'];

// ISO 14229 failure type byte, low nibble grouped by common meaning.
const FAILURE_TYPES = {
  0x00: 'no sub-type',
  0x01: 'general electrical failure',
  0x02: 'general signal failure',
  0x11: 'circuit shorted to ground',
  0x12: 'circuit shorted to battery',
  0x13: 'circuit open',
  0x14: 'circuit short to ground or open',
  0x15: 'circuit above threshold',
  0x16: 'circuit below threshold',
  0x17: 'circuit impedance too high',
  0x1c: 'circuit voltage out of range',
  0x21: 'signal too low',
  0x22: 'signal too high',
  0x23: 'signal stuck',
  0x29: 'signal invalid',
  0x2f: 'signal erratic',
  0x31: 'no signal',
  0x38: 'alignment or adjustment not learned',
  0x41: 'value above limit',
  0x42: 'value below limit',
  0x49: 'internal electronic failure',
  0x4b: 'over temperature',
  0x54: 'missing calibration',
  0x55: 'not programmed',
  0x62: 'signal compare failure',
  0x64: 'signal plausibility failure',
  0x68: 'event information',
  0x81: 'invalid serial data received',
  0x82: 'alive / sequence counter incorrect',
  0x83: 'value of signal protection calculation incorrect',
  0x86: 'signal invalid',
  0x87: 'missing message',
  0x92: 'performance or incorrect operation',
};

/** Decode the status byte ISO 14229 attaches to every DTC. */
export function decodeDtcStatus(b) {
  return {
    testFailed: !!(b & 0x01),
    testFailedThisCycle: !!(b & 0x02),
    pending: !!(b & 0x04),
    confirmed: !!(b & 0x08),
    testNotCompletedSinceClear: !!(b & 0x10),
    testFailedSinceClear: !!(b & 0x20),
    testNotCompletedThisCycle: !!(b & 0x40),
    warningIndicatorRequested: !!(b & 0x80),
  };
}

/**
 * Decode one 3-byte UDS DTC plus its status byte.
 * Returns null for all-zero padding.
 */
export function decodeUdsDtc(b1, b2, b3, statusByte) {
  if (b1 === 0 && b2 === 0 && b3 === 0) return null;

  const system = SYSTEMS[b1 >> 6];
  const firstDigit = (b1 >> 4) & 0x03;
  const rest = (((b1 & 0x0f) << 8) | b2).toString(16).toUpperCase().padStart(3, '0');
  const code = system + firstDigit + rest;

  const status = decodeDtcStatus(statusByte);
  return {
    code,
    failureType: b3,
    // "P0301-11" is how the factory tool and every forum thread writes it.
    fullCode: `${code}-${hex(b3)}`,
    failureDescription: FAILURE_TYPES[b3] || `failure type 0x${hex(b3)}`,
    status,
    active: status.testFailed || status.confirmed,
  };
}

/**
 * Parse a positive response to service 0x19 sub-function 0x02
 * (reportDTCByStatusMask).
 *
 * Layout: 59 02 <statusAvailabilityMask> then 4 bytes per DTC.
 */
export function parseDtcsByStatusMask(bytes) {
  const parsed = parseUdsResponse(bytes, SERVICE.READ_DTC_INFORMATION);
  if (parsed.kind !== 'positive') return parsed;

  const data = parsed.data;
  // data[0] is the sub-function echo (0x02), data[1] the availability mask.
  if (data.length < 2) return { kind: 'positive', dtcs: [] };
  const records = data.slice(2);

  const dtcs = [];
  for (let i = 0; i + 3 < records.length; i += 4) {
    const dtc = decodeUdsDtc(records[i], records[i + 1], records[i + 2], records[i + 3]);
    if (dtc && !dtcs.some((d) => d.fullCode === dtc.fullCode)) dtcs.push(dtc);
  }
  return { kind: 'positive', dtcs };
}
