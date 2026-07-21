// ble.js — Bluetooth Low Energy transport for the ELM327 adapter.
//
// iOS can only reach BLE adapters. Classic Bluetooth 3.0 / SPP dongles (the
// ones that ask for PIN 1234 in iOS Settings) are unreachable from any iPhone
// app — that's a Core Bluetooth limitation, not something code can work around.
//
// Characteristic UUIDs vary by clone: FFF1/FFF2, FFE1, 18F0, ... so rather
// than a hardcoded table we discover by *property* — find something we can
// write to and something that notifies. That works on adapters nobody has
// tested yet.

import { BleManager } from 'react-native-ble-plx';
import { Buffer } from 'buffer';

export const manager = new BleManager();

// BLE writes cap at the negotiated MTU; 20 bytes is the safe floor. ELM327
// commands are far shorter, but VIN reads and long AT strings can exceed it.
const CHUNK = 20;

/** Wait until the phone's Bluetooth radio is actually powered on. */
export function waitForPoweredOn(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error('Bluetooth is not turned on.'));
    }, timeoutMs);
    const sub = manager.onStateChange((state) => {
      if (state === 'PoweredOn') {
        clearTimeout(timer);
        sub.remove();
        resolve();
      }
    }, true);
  });
}

/**
 * Scan for every nearby BLE peripheral and report them as they appear.
 * We deliberately do NOT filter by name — this screen doubles as the test for
 * "is my cheap dongle BLE at all", and half these clones advertise as
 * "OBDII", "Vgate", "IOS-Vlink", or nothing at all.
 *
 * Returns a stop() function.
 */
export function scan(onDevice, onError) {
  const seen = new Map();
  manager.startDeviceScan(null, { allowDuplicates: false }, (error, device) => {
    if (error) {
      onError?.(error);
      return;
    }
    if (!device) return;
    const prev = seen.get(device.id);
    // Re-report when the name resolves later, which is common.
    if (prev && prev.name === device.name) return;
    seen.set(device.id, { name: device.name });
    onDevice({
      id: device.id,
      name: device.name || device.localName || null,
      rssi: device.rssi,
      likelyObd: looksLikeObd(device),
    });
  });
  return () => manager.stopDeviceScan();
}

/** Heuristic used only to sort the good candidates to the top of the list. */
function looksLikeObd(device) {
  const name = `${device.name || ''} ${device.localName || ''}`.toUpperCase();
  return /OBD|ELM|VLINK|VGATE|VEEPEAK|ICAR|KONNWEI|VIECAR|LINK|SCAN/.test(name);
}

/**
 * Connect and return a transport { write, subscribe, disconnect } that
 * Elm327 can drive.
 */
export async function connect(deviceId) {
  let device = await manager.connectToDevice(deviceId, { timeout: 15000 });
  device = await device.discoverAllServicesAndCharacteristics();

  // iOS negotiates MTU automatically; on Android ask for more so long replies
  // arrive in fewer notifications.
  try { device = await device.requestMTU(185); } catch { /* optional */ }

  const services = await device.services();
  let writeChar = null;
  let notifyChar = null;

  for (const service of services) {
    for (const c of await service.characteristics()) {
      if (!writeChar && (c.isWritableWithoutResponse || c.isWritableWithResponse)) writeChar = c;
      if (!notifyChar && (c.isNotifiable || c.isIndicatable)) notifyChar = c;
    }
    // Prefer a service that offers both — some adapters expose a stray
    // writable characteristic in an unrelated service (e.g. OTA update).
    if (writeChar && notifyChar && writeChar.serviceUUID === notifyChar.serviceUUID) break;
  }

  if (!writeChar || !notifyChar) {
    await device.cancelConnection().catch(() => {});
    throw new Error(
      'Connected, but this device has no readable/writable serial characteristics. It is probably not an OBD adapter.',
    );
  }

  const listeners = new Set();
  const subscription = notifyChar.monitor((error, c) => {
    if (error || !c?.value) return;
    const text = Buffer.from(c.value, 'base64').toString('ascii');
    listeners.forEach((fn) => fn(text));
  });

  const write = async (text) => {
    for (let i = 0; i < text.length; i += CHUNK) {
      const b64 = Buffer.from(text.slice(i, i + CHUNK), 'ascii').toString('base64');
      if (writeChar.isWritableWithoutResponse) {
        await writeChar.writeWithoutResponse(b64);
      } else {
        await writeChar.writeWithResponse(b64);
      }
    }
  };

  return {
    device,
    write,
    subscribe: (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    disconnect: async () => {
      subscription.remove();
      listeners.clear();
      await manager.cancelDeviceConnection(deviceId).catch(() => {});
    },
  };
}
