// obd.test.js — the one runnable check. No framework.
//
//   node src/obd/obd.test.js
//
// Everything here is real ELM327 output shapes, so if the decoding breaks this
// fails before you're standing in a driveway wondering why the app lies.

import assert from 'node:assert/strict';
import {
  Elm327,
  parseHexResponse,
  parseDtcResponse,
  parseVin,
} from './elm327.js';
import { decodeDtcBytes, describeDtc, isManufacturerSpecific } from './dtc.js';
import { decodePid, decodeStatus } from './pids.js';

let checks = 0;
const running = [];
const check = (name, fn) => {
  const done = () => { checks++; console.log('  ok  ' + name); };
  const fail = (e) => { console.error('  FAIL  ' + name + '\n' + e.message); process.exit(1); };
  try {
    const r = fn();
    // Async checks return a promise — track it so a failure inside one still
    // fails the process instead of printing a passing summary.
    if (r && typeof r.then === 'function') running.push(r.then(done, fail));
    else done();
  } catch (e) { fail(e); }
};

console.log('\nresponse framing');

check('single-frame CAN response', () => {
  assert.deepEqual(parseHexResponse('41057B\r\r'), [0x41, 0x05, 0x7b]);
});

check('spaces and prompt are stripped', () => {
  assert.deepEqual(parseHexResponse('41 05 7B \r\r>'), [0x41, 0x05, 0x7b]);
});

check('SEARCHING... noise is dropped', () => {
  assert.deepEqual(parseHexResponse('SEARCHING...\r41057B\r\r>'), [0x41, 0x05, 0x7b]);
});

check('NO DATA yields no bytes rather than garbage', () => {
  assert.deepEqual(parseHexResponse('NO DATA\r\r>'), []);
});

check('UNABLE TO CONNECT yields no bytes', () => {
  assert.deepEqual(parseHexResponse('UNABLE TO CONNECT\r\r>'), []);
});

check('multi-frame reply drops the length header and joins segments', () => {
  // Real Mode 09 VIN shape: total length, then numbered ISO-TP segments.
  const raw = '014\r0:490201314A34\r1:4142433435363738\r2:39303132330000\r\r>';
  const bytes = parseHexResponse(raw);
  assert.equal(bytes[0], 0x49, 'first byte should be the 0x49 mode echo');
  assert.equal(bytes[1], 0x02);
  // "014" must not have been decoded as data.
  assert.notEqual(bytes[0], 0x01);
});

console.log('\nDTC decoding');

check('bit layout maps to the right system letter', () => {
  assert.equal(decodeDtcBytes(0x01, 0x33), 'P0133');
  assert.equal(decodeDtcBytes(0x43, 0x21), 'C0321');
  assert.equal(decodeDtcBytes(0x81, 0x05), 'B0105');
  assert.equal(decodeDtcBytes(0xc1, 0x00), 'U0100');
});

check('first digit uses bits 4-5, not the whole nibble', () => {
  assert.equal(decodeDtcBytes(0x21, 0x71), 'P2171');
  assert.equal(decodeDtcBytes(0x31, 0x00), 'P3100');
});

check('all-zero padding decodes to nothing', () => {
  assert.equal(decodeDtcBytes(0x00, 0x00), null);
});

check('hex digits are preserved, not decimalised', () => {
  assert.equal(decodeDtcBytes(0x04, 0x20), 'P0420');
  assert.equal(decodeDtcBytes(0x0a, 0xbc), 'P0ABC');
});

check('known code gets its real description', () => {
  assert.match(describeDtc('P0420'), /Catalyst system efficiency/);
  assert.match(describeDtc('P0301'), /Cylinder 1 misfire/);
  assert.match(describeDtc('P0308'), /Cylinder 8 misfire/);
});

check('manufacturer-specific codes are flagged, not invented', () => {
  assert.equal(isManufacturerSpecific('P1234'), true);
  assert.equal(isManufacturerSpecific('P0420'), false);
  assert.match(describeDtc('P1234'), /manufacturer-specific/i);
  // Crucially it must NOT claim to know what it is.
  assert.doesNotMatch(describeDtc('P1234'), /Catalyst/);
});

check('unknown generic code falls back to structure, not a guess', () => {
  const d = describeDtc('P0399');
  assert.match(d, /ignition system or misfire/);
  assert.match(d, /not in this app/);
});

console.log('\nMode 03 / 07 / 0A');

check('CAN reply with count byte: two codes', () => {
  // 43 02 0133 0420
  const codes = parseDtcResponse([0x43, 0x02, 0x01, 0x33, 0x04, 0x20]);
  assert.deepEqual(codes, ['P0133', 'P0420']);
});

check('count byte is not mistaken for a code', () => {
  const codes = parseDtcResponse([0x43, 0x01, 0x01, 0x33]);
  assert.deepEqual(codes, ['P0133']);
});

check('CAN zero-padding is not decoded as extra codes', () => {
  // A real single-code reply fills the whole 8-byte CAN frame with zeros:
  // 43 01 0301 00 00 00. Reading past the count byte invents P0100s.
  const codes = parseDtcResponse([0x43, 0x01, 0x03, 0x01, 0x00, 0x00, 0x00]);
  assert.deepEqual(codes, ['P0301']);
});

check('padding is dropped even when the count is the frame maximum', () => {
  // 43 03 0133 0420 0301 — three codes, no room for padding.
  const codes = parseDtcResponse([0x43, 0x03, 0x01, 0x33, 0x04, 0x20, 0x03, 0x01]);
  assert.deepEqual(codes, ['P0133', 'P0420', 'P0301']);
});

check('no codes stored', () => {
  assert.deepEqual(parseDtcResponse([0x43, 0x00]), []);
});

check('mode 07 pending codes use the 0x47 echo', () => {
  const codes = parseDtcResponse([0x47, 0x01, 0x04, 0x20], 0x47);
  assert.deepEqual(codes, ['P0420']);
});

check('duplicate codes are collapsed', () => {
  const codes = parseDtcResponse([0x43, 0x02, 0x04, 0x20, 0x04, 0x20]);
  assert.deepEqual(codes, ['P0420']);
});

console.log('\nVIN');

check('VIN extracts 17 ASCII characters', () => {
  const vin = 'SALMF1D40BA123456';
  const bytes = [0x49, 0x02, 0x01, ...[...vin].map((c) => c.charCodeAt(0))];
  assert.equal(parseVin(bytes), vin);
  assert.equal(parseVin(bytes).length, 17);
});

console.log('\nlive data PIDs');

check('engine RPM: (256A+B)/4', () => {
  // 0x0B 0xB8 = 3000 -> 750 rpm
  assert.equal(decodePid('0C', [0x41, 0x0c, 0x0b, 0xb8]).value, 750);
});

check('coolant temp converts C to F with the -40 offset', () => {
  // 0x7B = 123 -> 83C -> 181.4F
  const v = decodePid('05', [0x41, 0x05, 0x7b]).value;
  assert.ok(Math.abs(v - 181.4) < 0.01, `got ${v}`);
});

check('vehicle speed converts km/h to mph', () => {
  const v = decodePid('0D', [0x41, 0x0d, 0x64]).value; // 100 km/h
  assert.ok(Math.abs(v - 62.1371) < 0.001, `got ${v}`);
});

check('fuel trim is signed around the 128 midpoint', () => {
  assert.equal(decodePid('06', [0x41, 0x06, 0x80]).value, 0);
  assert.ok(decodePid('06', [0x41, 0x06, 0x40]).value < 0);
  assert.ok(decodePid('06', [0x41, 0x06, 0xc0]).value > 0);
});

check('module voltage is millivolts', () => {
  // 0x36 0xB0 = 14000 -> 14.0V
  assert.equal(decodePid('42', [0x41, 0x42, 0x36, 0xb0]).value, 14);
});

check('a PID echo mismatch is rejected instead of silently decoded', () => {
  // Asked for coolant (05), adapter replied about RPM (0C).
  assert.equal(decodePid('05', [0x41, 0x0c, 0x0b, 0xb8]), null);
});

check('a truncated frame is rejected', () => {
  assert.equal(decodePid('0C', [0x41, 0x0c, 0x0b]), null);
});

check('an empty response is rejected', () => {
  assert.equal(decodePid('0C', []), null);
});

console.log('\nreadiness monitors');

check('MIL bit and stored code count', () => {
  // A = 0x83 -> MIL on, 3 codes
  const s = decodeStatus([0x41, 0x01, 0x83, 0x07, 0xff, 0x00]);
  assert.equal(s.milOn, true);
  assert.equal(s.dtcCount, 3);
});

check('MIL off reads as off', () => {
  const s = decodeStatus([0x41, 0x01, 0x00, 0x07, 0x00, 0x00]);
  assert.equal(s.milOn, false);
  assert.equal(s.dtcCount, 0);
});

check('incomplete monitors are reported incomplete', () => {
  // C = 0x21 -> Catalyst + Oxygen Sensor available.
  // D = 0x01 -> Catalyst incomplete, Oxygen Sensor complete.
  const s = decodeStatus([0x41, 0x01, 0x00, 0x00, 0x21, 0x01]);
  const cat = s.monitors.find((m) => m.name === 'Catalyst');
  const o2 = s.monitors.find((m) => m.name === 'Oxygen Sensor');
  assert.equal(cat.complete, false);
  assert.equal(o2.complete, true);
  // Unavailable monitors must not be listed at all.
  assert.equal(s.monitors.find((m) => m.name === 'EGR System'), undefined);
});

console.log('\ncommand serialization');

check('commands queue instead of interleaving', async () => {
  // A fake adapter that answers slowly and records what it was asked.
  const asked = [];
  let listener = null;
  const transport = {
    write: async (s) => {
      asked.push(s.trim());
      const reply = s.startsWith('010C') ? '410C0BB8\r\r>' : '41057B\r\r>';
      setTimeout(() => listener(reply), 5);
    },
    subscribe: (cb) => { listener = cb; return () => {}; },
  };
  const elm = new Elm327(transport);

  return Promise.all([elm.readPid('0C'), elm.readPid('05')]).then(([rpm, temp]) => {
    assert.deepEqual(asked, ['010C', '0105'], 'commands must be sent in order');
    assert.equal(rpm.value, 750);
    assert.ok(Math.abs(temp.value - 181.4) < 0.01);
    elm.close();
  });
});

check('a timeout does not poison the next command', async () => {
  let listener = null;
  let first = true;
  const transport = {
    write: async (s) => {
      if (first) { first = false; return; }        // swallow it -> timeout
      setTimeout(() => listener('41057B\r\r>'), 5);
    },
    subscribe: (cb) => { listener = cb; return () => {}; },
  };
  const elm = new Elm327(transport);

  return elm.send('010C', 30)
    .then(() => { throw new Error('should have timed out'); }, () => elm.readPid('05'))
    .then((temp) => {
      assert.ok(temp && Math.abs(temp.value - 181.4) < 0.01, 'next command must still work');
      elm.close();
    });
});

await Promise.all(running);
console.log(`\n${checks} checks passed\n`);
