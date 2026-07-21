// store.js — single source of truth for connection + vehicle state.

import { create } from 'zustand';
import { Elm327 } from './obd/elm327.js';
import * as ble from './ble.js';
import { DEFAULT_LIVE_PIDS } from './obd/pids.js';

export const useStore = create((set, get) => ({
  // connection
  phase: 'idle',            // idle | scanning | connecting | ready | error
  error: null,
  devices: [],
  transport: null,
  elm: null,
  deviceName: null,
  protocol: null,

  // vehicle
  vin: null,
  status: null,             // MIL + readiness monitors
  codes: null,              // { stored, pending, permanent }
  supportedPids: DEFAULT_LIVE_PIDS,
  live: {},                 // pid -> { value, name, unit }

  // a rolling transcript, so a failure in a driveway is diagnosable
  log: [],
  appendLog: (line) =>
    set((s) => ({ log: [...s.log.slice(-200), line] })),

  async startScan() {
    set({ phase: 'scanning', devices: [], error: null });
    try {
      await ble.waitForPoweredOn();
    } catch (e) {
      set({ phase: 'error', error: e.message });
      return;
    }
    const stop = ble.scan(
      (device) =>
        set((s) => {
          const rest = s.devices.filter((d) => d.id !== device.id);
          // Likely adapters first, then by signal strength.
          return {
            devices: [...rest, device].sort(
              (a, b) => (b.likelyObd - a.likelyObd) || ((b.rssi || -999) - (a.rssi || -999)),
            ),
          };
        }),
      (e) => set({ phase: 'error', error: e.message }),
    );
    set({ _stopScan: stop });
  },

  stopScan() {
    get()._stopScan?.();
    set((s) => ({ _stopScan: null, phase: s.phase === 'scanning' ? 'idle' : s.phase }));
  },

  async connect(deviceId, deviceName) {
    get().stopScan();
    set({ phase: 'connecting', error: null, deviceName });
    try {
      const transport = await ble.connect(deviceId);
      const elm = new Elm327(transport, { log: (l) => get().appendLog(l) });
      const { protocol } = await elm.init();

      set({ transport, elm, protocol, phase: 'ready' });

      // Best-effort vehicle identification; none of it should block the UI.
      const [vin, status, supported] = await Promise.all([
        elm.readVin().catch(() => null),
        elm.readStatus().catch(() => null),
        elm.readSupportedPids().catch(() => DEFAULT_LIVE_PIDS),
      ]);
      set({
        vin,
        status,
        supportedPids: supported.length ? supported : DEFAULT_LIVE_PIDS,
      });
    } catch (e) {
      await get().disconnect();
      set({ phase: 'error', error: e.message });
    }
  },

  async disconnect() {
    const { elm, transport } = get();
    elm?.close();
    await transport?.disconnect().catch(() => {});
    set({
      phase: 'idle', elm: null, transport: null, deviceName: null,
      vin: null, status: null, codes: null, live: {}, protocol: null,
    });
  },

  async refreshCodes() {
    const { elm } = get();
    if (!elm) return;
    set({ codesLoading: true, error: null });
    try {
      const [codes, status] = await Promise.all([elm.readCodes(), elm.readStatus().catch(() => null)]);
      set({ codes, status, codesLoading: false });
    } catch (e) {
      set({ error: e.message, codesLoading: false });
    }
  },

  async clearCodes() {
    const { elm } = get();
    if (!elm) return;
    set({ codesLoading: true, error: null });
    try {
      await elm.clearCodes();
      // Re-read rather than assuming: a hard fault comes straight back, and
      // that is exactly what you need to know.
      const [codes, status] = await Promise.all([elm.readCodes(), elm.readStatus().catch(() => null)]);
      set({ codes, status, codesLoading: false });
    } catch (e) {
      set({ error: e.message, codesLoading: false });
    }
  },

  // --- UDS module access ---------------------------------------------------
  modules: null,
  moduleDtcs: {},
  moduleBusy: null,
  sweep: null,
  sweptOnce: false,

  async discoverModules() {
    const { elm } = get();
    if (!elm) return;
    // Live polling competes for the same command queue and makes the sweep
    // crawl; the bus is also quieter without it.
    const wasLive = get()._liveRunning;
    get().stopLive();

    set({ sweep: { running: true, index: 0, total: 0, current: '' }, error: null });
    try {
      const found = await elm.discoverModules(undefined, ({ index, total, module }) =>
        set({ sweep: { running: true, index, total, current: module.name } }));
      set({ modules: found, sweep: null, sweptOnce: true });
    } catch (e) {
      set({ error: e.message, sweep: null, sweptOnce: true });
    }
    if (wasLive) get().startLive(get().supportedPids);
  },

  async readModuleDtcs(reqId) {
    const { elm } = get();
    if (!elm) return;
    set({ moduleBusy: reqId, error: null });
    try {
      const result = await elm.readModuleDtcs(reqId);
      set((s) => ({ moduleDtcs: { ...s.moduleDtcs, [reqId]: result }, moduleBusy: null }));
    } catch (e) {
      set({ error: e.message, moduleBusy: null });
    } finally {
      // Always hand the adapter back to broadcast mode, or every later
      // generic OBD request silently goes to the module we last targeted.
      await elm.targetModule(null).catch(() => {});
    }
  },

  /**
   * Poll live PIDs round-robin until stopped. One command in flight at a time
   * is enforced by Elm327 anyway; this just keeps the queue fed.
   */
  startLive(pids) {
    if (get()._liveRunning) return;
    set({ _liveRunning: true });
    const loop = async () => {
      while (get()._liveRunning) {
        const { elm } = get();
        if (!elm) break;
        for (const pid of pids) {
          if (!get()._liveRunning) break;
          try {
            const reading = await elm.readPid(pid);
            if (reading) set((s) => ({ live: { ...s.live, [pid]: reading } }));
          } catch {
            // A single dropped frame is normal on a cheap adapter; keep going.
          }
        }
      }
    };
    loop();
  },

  stopLive() {
    set({ _liveRunning: false });
  },
}));
