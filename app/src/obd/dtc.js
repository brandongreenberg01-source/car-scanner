// dtc.js — Diagnostic Trouble Code decoding.
//
// A DTC on the wire is 2 bytes. The top 2 bits pick the system letter, the
// next 2 bits are the first digit, and the low 12 bits are the last 3 hex
// digits. That structure is universal, so even a code we have no description
// for still decodes into something meaningful.
//
// ponytail: the description table is the ~150 codes a 2011 Range Rover (or any
// gas V8) actually throws, not all ~5000 SAE codes. Ceiling: unknown generic
// codes fall back to a structural description. Upgrade path is to paste a full
// SAE CSV into CODES — the lookup doesn't change.

const SYSTEMS = ['P', 'C', 'B', 'U'];

const SYSTEM_NAMES = {
  P: 'Powertrain',
  C: 'Chassis',
  B: 'Body',
  U: 'Network',
};

// Which subsystem the 3rd digit refers to, for the structural fallback.
const P_SUBSYSTEM = {
  0: 'fuel and air metering / auxiliary emission controls',
  1: 'fuel and air metering',
  2: 'fuel and air metering (injector circuit)',
  3: 'ignition system or misfire',
  4: 'auxiliary emission controls',
  5: 'vehicle speed, idle control, auxiliary inputs',
  6: 'computer output circuit',
  7: 'transmission',
  8: 'transmission',
  9: 'transmission / control module',
  A: 'hybrid propulsion',
  B: 'hybrid propulsion',
  C: 'hybrid propulsion',
};

const CODES = {
  // --- Fuel trim / mixture -------------------------------------------------
  P0171: 'System too lean, Bank 1',
  P0172: 'System too rich, Bank 1',
  P0174: 'System too lean, Bank 2',
  P0175: 'System too rich, Bank 2',
  P0170: 'Fuel trim malfunction, Bank 1',
  P0173: 'Fuel trim malfunction, Bank 2',

  // --- Mass air flow / manifold pressure -----------------------------------
  P0100: 'Mass air flow circuit malfunction',
  P0101: 'Mass air flow circuit range/performance',
  P0102: 'Mass air flow circuit low input',
  P0103: 'Mass air flow circuit high input',
  P0105: 'Manifold absolute pressure circuit malfunction',
  P0106: 'Manifold absolute pressure range/performance',
  P0107: 'Manifold absolute pressure circuit low input',
  P0108: 'Manifold absolute pressure circuit high input',

  // --- Air and coolant temperature -----------------------------------------
  P0110: 'Intake air temperature circuit malfunction',
  P0111: 'Intake air temperature range/performance',
  P0112: 'Intake air temperature circuit low input',
  P0113: 'Intake air temperature circuit high input',
  P0115: 'Engine coolant temperature circuit malfunction',
  P0116: 'Engine coolant temperature range/performance',
  P0117: 'Engine coolant temperature circuit low input',
  P0118: 'Engine coolant temperature circuit high input',
  P0125: 'Insufficient coolant temperature for closed loop fuel control',
  P0128: 'Coolant thermostat below regulating temperature',

  // --- Throttle / pedal ----------------------------------------------------
  P0120: 'Throttle position sensor A circuit malfunction',
  P0121: 'Throttle position sensor A range/performance',
  P0122: 'Throttle position sensor A circuit low input',
  P0123: 'Throttle position sensor A circuit high input',
  P0221: 'Throttle position sensor B range/performance',
  P0222: 'Throttle position sensor B circuit low input',
  P0223: 'Throttle position sensor B circuit high input',
  P2135: 'Throttle position sensor A/B voltage correlation',

  // --- Oxygen sensors ------------------------------------------------------
  P0130: 'O2 sensor circuit, Bank 1 Sensor 1',
  P0131: 'O2 sensor circuit low voltage, Bank 1 Sensor 1',
  P0132: 'O2 sensor circuit high voltage, Bank 1 Sensor 1',
  P0133: 'O2 sensor circuit slow response, Bank 1 Sensor 1',
  P0134: 'O2 sensor circuit no activity detected, Bank 1 Sensor 1',
  P0135: 'O2 sensor heater circuit, Bank 1 Sensor 1',
  P0136: 'O2 sensor circuit, Bank 1 Sensor 2',
  P0137: 'O2 sensor circuit low voltage, Bank 1 Sensor 2',
  P0138: 'O2 sensor circuit high voltage, Bank 1 Sensor 2',
  P0139: 'O2 sensor circuit slow response, Bank 1 Sensor 2',
  P0140: 'O2 sensor circuit no activity detected, Bank 1 Sensor 2',
  P0141: 'O2 sensor heater circuit, Bank 1 Sensor 2',
  P0150: 'O2 sensor circuit, Bank 2 Sensor 1',
  P0151: 'O2 sensor circuit low voltage, Bank 2 Sensor 1',
  P0152: 'O2 sensor circuit high voltage, Bank 2 Sensor 1',
  P0153: 'O2 sensor circuit slow response, Bank 2 Sensor 1',
  P0154: 'O2 sensor circuit no activity detected, Bank 2 Sensor 1',
  P0155: 'O2 sensor heater circuit, Bank 2 Sensor 1',
  P0156: 'O2 sensor circuit, Bank 2 Sensor 2',
  P0157: 'O2 sensor circuit low voltage, Bank 2 Sensor 2',
  P0158: 'O2 sensor circuit high voltage, Bank 2 Sensor 2',
  P0159: 'O2 sensor circuit slow response, Bank 2 Sensor 2',
  P0160: 'O2 sensor circuit no activity detected, Bank 2 Sensor 2',
  P0161: 'O2 sensor heater circuit, Bank 2 Sensor 2',

  // --- Ignition / misfire (P0301+ generated below) -------------------------
  P0300: 'Random / multiple cylinder misfire detected',
  P0316: 'Misfire detected on startup',
  P0350: 'Ignition coil primary/secondary circuit',

  // --- Camshaft / crankshaft ----------------------------------------------
  P0011: 'Camshaft position, intake timing over-advanced, Bank 1',
  P0012: 'Camshaft position, intake timing over-retarded, Bank 1',
  P0014: 'Camshaft position, exhaust timing over-advanced, Bank 1',
  P0015: 'Camshaft position, exhaust timing over-retarded, Bank 1',
  P0016: 'Crankshaft / camshaft position correlation, Bank 1 Sensor A',
  P0017: 'Crankshaft / camshaft position correlation, Bank 1 Sensor B',
  P0018: 'Crankshaft / camshaft position correlation, Bank 2 Sensor A',
  P0019: 'Crankshaft / camshaft position correlation, Bank 2 Sensor B',
  P0021: 'Camshaft position, intake timing over-advanced, Bank 2',
  P0022: 'Camshaft position, intake timing over-retarded, Bank 2',
  P0024: 'Camshaft position, exhaust timing over-advanced, Bank 2',
  P0025: 'Camshaft position, exhaust timing over-retarded, Bank 2',
  P0335: 'Crankshaft position sensor A circuit',
  P0336: 'Crankshaft position sensor A range/performance',
  P0340: 'Camshaft position sensor A circuit, Bank 1',
  P0341: 'Camshaft position sensor A range/performance, Bank 1',
  P0345: 'Camshaft position sensor A circuit, Bank 2',
  P0346: 'Camshaft position sensor A range/performance, Bank 2',
  P0365: 'Camshaft position sensor B circuit, Bank 1',
  P0390: 'Camshaft position sensor B circuit, Bank 2',

  // --- Catalyst / EGR / secondary air --------------------------------------
  P0401: 'EGR flow insufficient detected',
  P0402: 'EGR flow excessive detected',
  P0403: 'EGR control circuit',
  P0404: 'EGR control circuit range/performance',
  P0411: 'Secondary air injection system incorrect flow',
  P0412: 'Secondary air injection valve A circuit',
  P0420: 'Catalyst system efficiency below threshold, Bank 1',
  P0430: 'Catalyst system efficiency below threshold, Bank 2',

  // --- EVAP ----------------------------------------------------------------
  P0440: 'Evaporative emission control system malfunction',
  P0441: 'Evaporative emission system incorrect purge flow',
  P0442: 'Evaporative emission system leak detected (small leak)',
  P0443: 'Evaporative emission system purge control valve circuit',
  P0446: 'Evaporative emission system vent control circuit',
  P0447: 'Evaporative emission system vent control circuit open',
  P0448: 'Evaporative emission system vent control circuit shorted',
  P0451: 'Evaporative emission pressure sensor range/performance',
  P0452: 'Evaporative emission pressure sensor low input',
  P0453: 'Evaporative emission pressure sensor high input',
  P0455: 'Evaporative emission system leak detected (large leak)',
  P0456: 'Evaporative emission system leak detected (very small leak)',
  P0457: 'Evaporative emission system leak detected (fuel cap loose/off)',

  // --- Fuel delivery -------------------------------------------------------
  P0087: 'Fuel rail / system pressure too low',
  P0088: 'Fuel rail / system pressure too high',
  P0089: 'Fuel pressure regulator performance',
  P0093: 'Fuel system large leak detected',
  P0190: 'Fuel rail pressure sensor circuit',
  P0191: 'Fuel rail pressure sensor range/performance',
  P0230: 'Fuel pump primary circuit',
  P0231: 'Fuel pump secondary circuit low',
  P0232: 'Fuel pump secondary circuit high',
  P0462: 'Fuel level sensor circuit low input',
  P0463: 'Fuel level sensor circuit high input',

  // --- Speed / idle / auxiliary --------------------------------------------
  P0500: 'Vehicle speed sensor malfunction',
  P0501: 'Vehicle speed sensor range/performance',
  P0505: 'Idle air control system malfunction',
  P0506: 'Idle air control system RPM lower than expected',
  P0507: 'Idle air control system RPM higher than expected',
  P0524: 'Engine oil pressure too low',
  P0562: 'System voltage low',
  P0563: 'System voltage high',
  P0571: 'Brake switch A circuit',

  // --- Control module ------------------------------------------------------
  P0600: 'Serial communication link malfunction',
  P0601: 'Internal control module memory checksum error',
  P0602: 'Control module programming error',
  P0603: 'Internal control module keep-alive memory error',
  P0604: 'Internal control module RAM error',
  P0605: 'Internal control module ROM error',
  P0606: 'ECM / PCM processor fault',
  P0620: 'Generator control circuit',
  P0625: 'Generator field / F terminal circuit low',
  P0626: 'Generator field / F terminal circuit high',
  P0645: 'A/C clutch relay control circuit',

  // --- Transmission --------------------------------------------------------
  P0700: 'Transmission control system (MIL request)',
  P0701: 'Transmission control system range/performance',
  P0702: 'Transmission control system electrical',
  P0705: 'Transmission range sensor circuit',
  P0706: 'Transmission range sensor range/performance',
  P0710: 'Transmission fluid temperature sensor circuit',
  P0715: 'Input / turbine speed sensor circuit',
  P0720: 'Output speed sensor circuit',
  P0730: 'Incorrect gear ratio',
  P0731: 'Gear 1 incorrect ratio',
  P0732: 'Gear 2 incorrect ratio',
  P0733: 'Gear 3 incorrect ratio',
  P0734: 'Gear 4 incorrect ratio',
  P0735: 'Gear 5 incorrect ratio',
  P0736: 'Reverse incorrect ratio',
  P0740: 'Torque converter clutch circuit malfunction',
  P0741: 'Torque converter clutch circuit performance / stuck off',
  P0742: 'Torque converter clutch circuit stuck on',
  P0750: 'Shift solenoid A malfunction',
  P0755: 'Shift solenoid B malfunction',
  P0760: 'Shift solenoid C malfunction',

  // --- Network / lost communication ---------------------------------------
  U0001: 'High speed CAN communication bus',
  U0073: 'Control module communication bus A off',
  U0100: 'Lost communication with ECM / PCM A',
  U0101: 'Lost communication with transmission control module',
  U0121: 'Lost communication with ABS control module',
  U0122: 'Lost communication with vehicle dynamics control module',
  U0140: 'Lost communication with body control module',
  U0155: 'Lost communication with instrument panel cluster',
  U0401: 'Invalid data received from ECM / PCM A',
  U0415: 'Invalid data received from ABS control module',
};

// Cylinder misfires are perfectly regular — generate rather than type 12 lines.
for (let cyl = 1; cyl <= 12; cyl++) {
  CODES['P0' + (300 + cyl)] = `Cylinder ${cyl} misfire detected`;
  CODES['P0' + (200 + cyl)] = `Injector circuit / open, cylinder ${cyl}`;
}

/**
 * Decode a raw 2-byte DTC into its code string, e.g. [0x01, 0x33] -> "P0133".
 * Returns null for the all-zero padding the ECU uses to fill out a frame.
 */
export function decodeDtcBytes(b1, b2) {
  if (b1 === 0 && b2 === 0) return null;
  const system = SYSTEMS[b1 >> 6];
  const firstDigit = (b1 >> 4) & 0x03;
  const rest = (((b1 & 0x0f) << 8) | b2).toString(16).toUpperCase().padStart(3, '0');
  return system + firstDigit + rest;
}

/**
 * True when the second digit is 1 — SAE reserves those for the manufacturer,
 * so no generic table can describe them and we shouldn't pretend otherwise.
 */
export function isManufacturerSpecific(code) {
  return code[1] === '1';
}

/**
 * Human-readable description. Falls back to a structural description built
 * from the code's own bit layout rather than inventing a definition.
 */
export function describeDtc(code) {
  const known = CODES[code];
  if (known) return known;

  const system = SYSTEM_NAMES[code[0]] || 'Unknown';
  if (isManufacturerSpecific(code)) {
    return `${system} — Land Rover / Jaguar manufacturer-specific code. Not in the generic OBD-II set; needs a JLR-specific lookup.`;
  }
  if (code[0] === 'P') {
    const area = P_SUBSYSTEM[code[2]];
    return area
      ? `Powertrain fault in ${area}. Generic code, exact definition not in this app's table.`
      : 'Powertrain fault. Generic code, exact definition not in this app\'s table.';
  }
  return `${system} fault. Exact definition not in this app's table.`;
}

/** Convenience: everything the UI needs about one code. */
export function explainDtc(code) {
  return {
    code,
    description: describeDtc(code),
    system: SYSTEM_NAMES[code[0]] || 'Unknown',
    manufacturerSpecific: isManufacturerSpecific(code),
    known: !!CODES[code],
  };
}

export const DTC_TABLE_SIZE = Object.keys(CODES).length;
