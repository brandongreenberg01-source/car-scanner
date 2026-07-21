// pids.js — Mode 01 live-data parameter definitions.
//
// Each entry converts the raw bytes the ECU returns into a US-unit number the
// gauge screen can show directly. Formulas are straight out of SAE J1979.
//
// `bytes` is how many data bytes follow the "41 <pid>" echo — used to sanity
// check a response before decoding it, because ELM327 clones will happily
// return a truncated frame.

const c2f = (c) => c * 9 / 5 + 32;
const kmh2mph = (k) => k * 0.621371;
const kpa2psi = (k) => k * 0.145038;

export const PIDS = {
  '04': {
    name: 'Engine Load',
    unit: '%',
    bytes: 1,
    decode: ([a]) => (a * 100) / 255,
    range: [0, 100],
  },
  '05': {
    name: 'Coolant Temp',
    unit: '°F',
    bytes: 1,
    decode: ([a]) => c2f(a - 40),
    // Normal operating band for the 5.0 V8 is roughly 195–220°F.
    range: [-40, 300],
    warn: (v) => v > 230,
  },
  '06': {
    name: 'Short Fuel Trim B1',
    unit: '%',
    bytes: 1,
    decode: ([a]) => (a - 128) * 100 / 128,
    range: [-100, 99],
    warn: (v) => Math.abs(v) > 10,
  },
  '07': {
    name: 'Long Fuel Trim B1',
    unit: '%',
    bytes: 1,
    decode: ([a]) => (a - 128) * 100 / 128,
    range: [-100, 99],
    warn: (v) => Math.abs(v) > 10,
  },
  '08': {
    name: 'Short Fuel Trim B2',
    unit: '%',
    bytes: 1,
    decode: ([a]) => (a - 128) * 100 / 128,
    range: [-100, 99],
    warn: (v) => Math.abs(v) > 10,
  },
  '09': {
    name: 'Long Fuel Trim B2',
    unit: '%',
    bytes: 1,
    decode: ([a]) => (a - 128) * 100 / 128,
    range: [-100, 99],
    warn: (v) => Math.abs(v) > 10,
  },
  '0B': {
    name: 'Intake Manifold Pressure',
    unit: 'psi',
    bytes: 1,
    decode: ([a]) => kpa2psi(a),
    range: [0, 37],
  },
  '0C': {
    name: 'Engine Speed',
    unit: 'rpm',
    bytes: 2,
    decode: ([a, b]) => ((a * 256) + b) / 4,
    range: [0, 8000],
  },
  '0D': {
    name: 'Vehicle Speed',
    unit: 'mph',
    bytes: 1,
    decode: ([a]) => kmh2mph(a),
    range: [0, 160],
  },
  '0E': {
    name: 'Timing Advance',
    unit: '°',
    bytes: 1,
    decode: ([a]) => a / 2 - 64,
    range: [-64, 63],
  },
  '0F': {
    name: 'Intake Air Temp',
    unit: '°F',
    bytes: 1,
    decode: ([a]) => c2f(a - 40),
    range: [-40, 300],
  },
  '10': {
    name: 'Mass Air Flow',
    unit: 'g/s',
    bytes: 2,
    decode: ([a, b]) => ((a * 256) + b) / 100,
    range: [0, 655],
  },
  '11': {
    name: 'Throttle Position',
    unit: '%',
    bytes: 1,
    decode: ([a]) => (a * 100) / 255,
    range: [0, 100],
  },
  '1F': {
    name: 'Run Time Since Start',
    unit: 's',
    bytes: 2,
    decode: ([a, b]) => (a * 256) + b,
    range: [0, 65535],
  },
  '21': {
    name: 'Distance With MIL On',
    unit: 'mi',
    bytes: 2,
    decode: ([a, b]) => kmh2mph((a * 256) + b),
    range: [0, 65535],
    // Any non-zero value means the light has been on while driving.
    warn: (v) => v > 0,
  },
  '2F': {
    name: 'Fuel Level',
    unit: '%',
    bytes: 1,
    decode: ([a]) => (a * 100) / 255,
    range: [0, 100],
  },
  '31': {
    name: 'Distance Since Codes Cleared',
    unit: 'mi',
    bytes: 2,
    decode: ([a, b]) => kmh2mph((a * 256) + b),
    range: [0, 65535],
  },
  '33': {
    name: 'Barometric Pressure',
    unit: 'psi',
    bytes: 1,
    decode: ([a]) => kpa2psi(a),
    range: [0, 37],
  },
  '42': {
    name: 'Module Voltage',
    unit: 'V',
    bytes: 2,
    decode: ([a, b]) => ((a * 256) + b) / 1000,
    range: [0, 66],
    // Below ~12V with the engine running points at the alternator or battery.
    warn: (v) => v < 12.0 || v > 15.0,
  },
  '43': {
    name: 'Absolute Load',
    unit: '%',
    bytes: 2,
    decode: ([a, b]) => ((a * 256) + b) * 100 / 255,
    range: [0, 25700],
  },
  '46': {
    name: 'Ambient Air Temp',
    unit: '°F',
    bytes: 1,
    decode: ([a]) => c2f(a - 40),
    range: [-40, 300],
  },
  '5C': {
    name: 'Engine Oil Temp',
    unit: '°F',
    bytes: 1,
    decode: ([a]) => c2f(a - 40),
    range: [-40, 400],
    warn: (v) => v > 270,
  },
  '5E': {
    name: 'Fuel Rate',
    unit: 'gal/h',
    bytes: 2,
    decode: ([a, b]) => ((a * 256) + b) / 20 * 0.264172,
    range: [0, 900],
  },
};

// What the Live screen polls by default. Ordered by how much you actually
// stare at it while diagnosing.
export const DEFAULT_LIVE_PIDS = ['0C', '0D', '05', '5C', '42', '04', '11', '10', '06', '07', '08', '09'];

/**
 * Decode a Mode 01 response payload for one PID.
 * `payload` is the full response byte array including the 0x41 echo and PID.
 * Returns null when the frame doesn't match what this PID should look like.
 */
export function decodePid(pid, payload) {
  const def = PIDS[pid];
  if (!def) return null;
  if (payload.length < 2) return null;
  if (payload[0] !== 0x41) return null;
  if (payload[1] !== parseInt(pid, 16)) return null;

  const data = payload.slice(2);
  if (data.length < def.bytes) return null;

  const value = def.decode(data);
  if (!Number.isFinite(value)) return null;
  return { pid, name: def.name, unit: def.unit, value };
}

/**
 * Decode Mode 01 PID 01 — MIL state, stored code count, readiness monitors.
 * This is what an emissions station reads, so "are my monitors ready" is a
 * real question the app can answer.
 */
export function decodeStatus(payload) {
  if (payload.length < 6 || payload[0] !== 0x41 || payload[1] !== 0x01) return null;
  const [, , a, b, c, d] = payload;

  const compressionIgnition = !!(b & 0x08);

  // Continuous monitors live in the low nibble of B: available bits 0-2,
  // incomplete bits 4-6.
  const continuous = [
    { name: 'Misfire', available: !!(b & 0x01), complete: !(b & 0x10) },
    { name: 'Fuel System', available: !!(b & 0x02), complete: !(b & 0x20) },
    { name: 'Components', available: !!(b & 0x04), complete: !(b & 0x40) },
  ];

  // Non-continuous monitors: C = available, D = incomplete, same bit order.
  const sparkNames = [
    'Catalyst',
    'Heated Catalyst',
    'Evaporative System',
    'Secondary Air System',
    'A/C Refrigerant',
    'Oxygen Sensor',
    'Oxygen Sensor Heater',
    'EGR System',
  ];
  const nonContinuous = sparkNames.map((name, i) => ({
    name,
    available: !!(c & (1 << i)),
    complete: !(d & (1 << i)),
  }));

  return {
    milOn: !!(a & 0x80),
    dtcCount: a & 0x7f,
    compressionIgnition,
    monitors: [...continuous, ...nonContinuous].filter((m) => m.available),
  };
}
