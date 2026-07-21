import React, { useEffect } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useStore } from '../store.js';
import { T, F } from '../theme.js';

export default function Connect() {
  const s = useStore();

  useEffect(() => () => useStore.getState().stopScan(), []);

  if (s.phase === 'ready') return <Connected s={s} />;

  return (
    <ScrollView contentContainerStyle={st.pad}>
      <Text style={st.h1}>Adapter</Text>
      <Text style={st.body}>
        Plug the adapter into the OBD port (under the dash, left of the steering
        column) and turn the ignition to position II. Then scan.
      </Text>

      <Pressable
        style={[st.btn, s.phase === 'scanning' && st.btnActive]}
        onPress={() => (s.phase === 'scanning' ? s.stopScan() : s.startScan())}
      >
        <Text style={st.btnText}>
          {s.phase === 'scanning' ? 'Stop scanning' : 'Scan for adapters'}
        </Text>
      </Pressable>

      {s.phase === 'connecting' && (
        <View style={st.row}>
          <ActivityIndicator color={T.accent} />
          <Text style={[st.body, { marginLeft: 10 }]}>
            Connecting to {s.deviceName || 'adapter'}…
          </Text>
        </View>
      )}

      {s.error ? <Text style={st.err}>{s.error}</Text> : null}

      {s.devices.map((d) => (
        <Pressable key={d.id} style={st.device} onPress={() => s.connect(d.id, d.name)}>
          <View style={{ flex: 1 }}>
            <Text style={st.deviceName}>{d.name || 'Unnamed device'}</Text>
            <Text style={st.deviceMeta}>
              {d.id.slice(0, 8)}…  ·  {d.rssi ?? '—'} dBm
            </Text>
          </View>
          {d.likelyObd && <Text style={st.tag}>LIKELY OBD</Text>}
        </Pressable>
      ))}

      {s.phase === 'scanning' && (
        <View style={st.note}>
          <Text style={st.noteText}>
            Scanning shows every Bluetooth Low Energy device nearby. If your
            adapter never appears here, it is a classic Bluetooth 3.0 (SPP)
            dongle — those cannot be reached by any iPhone app. A BLE adapter
            (Vgate iCar Pro, Veepeak BLE+) will work with this app unchanged.
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

function Connected({ s }) {
  const monitorsReady = s.status?.monitors.filter((m) => m.complete).length ?? 0;
  const monitorsTotal = s.status?.monitors.length ?? 0;

  return (
    <ScrollView contentContainerStyle={st.pad}>
      <View style={[st.card, { borderColor: s.status?.milOn ? T.bad : T.ok }]}>
        <Text style={st.cardLabel}>CHECK ENGINE LIGHT</Text>
        <Text style={[st.big, { color: s.status?.milOn ? T.bad : T.ok }]}>
          {s.status ? (s.status.milOn ? 'ON' : 'OFF') : '—'}
        </Text>
        {s.status && (
          <Text style={st.cardMeta}>
            {s.status.dtcCount} stored {s.status.dtcCount === 1 ? 'code' : 'codes'}
          </Text>
        )}
      </View>

      <View style={st.card}>
        <Text style={st.cardLabel}>VEHICLE</Text>
        <Text style={st.vin}>{s.vin || 'VIN not reported'}</Text>
        <Text style={st.cardMeta}>
          {s.deviceName || 'Adapter'} · protocol {s.protocol || '?'}
        </Text>
      </View>

      <View style={st.card}>
        <Text style={st.cardLabel}>
          EMISSIONS READINESS  ·  {monitorsReady}/{monitorsTotal} COMPLETE
        </Text>
        {(s.status?.monitors || []).map((m) => (
          <View key={m.name} style={st.monitor}>
            <Text style={st.monitorName}>{m.name}</Text>
            <Text style={[st.monitorState, { color: m.complete ? T.ok : T.warn }]}>
              {m.complete ? 'Ready' : 'Not ready'}
            </Text>
          </View>
        ))}
        {monitorsTotal > 0 && monitorsReady < monitorsTotal && (
          <Text style={st.cardMeta}>
            Incomplete monitors mean a failed emissions test. They reset
            whenever codes are cleared or the battery is disconnected, and
            refill over a few days of mixed driving.
          </Text>
        )}
      </View>

      <Pressable style={[st.btn, st.btnGhost]} onPress={() => s.disconnect()}>
        <Text style={[st.btnText, { color: T.dim }]}>Disconnect</Text>
      </Pressable>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 40 },
  h1: { color: T.text, fontSize: 28, fontWeight: '700', marginBottom: 8 },
  body: { color: T.dim, fontSize: 15, lineHeight: 21, marginBottom: 16 },
  row: { flexDirection: 'row', alignItems: 'center', marginTop: 16 },

  btn: {
    backgroundColor: T.accent, borderRadius: T.radius,
    paddingVertical: 16, alignItems: 'center', marginBottom: 8,
  },
  btnActive: { backgroundColor: T.panel, borderWidth: 1, borderColor: T.accent },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: T.panelEdge, marginTop: 20 },
  btnText: { color: '#04202B', fontSize: 17, fontWeight: '700' },

  err: {
    color: T.bad, fontSize: 15, lineHeight: 21, marginTop: 14,
    backgroundColor: '#2A1416', borderRadius: T.radius, padding: 14,
  },

  device: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: T.panel, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.panelEdge,
    padding: 16, marginTop: 10,
  },
  deviceName: { color: T.text, fontSize: 17, fontWeight: '600' },
  deviceMeta: { color: T.faint, fontSize: 13, marginTop: 3, fontFamily: F.mono },
  tag: { color: T.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.5 },

  note: { marginTop: 24, padding: 14, backgroundColor: T.panel, borderRadius: T.radius },
  noteText: { color: T.faint, fontSize: 13, lineHeight: 19 },

  card: {
    backgroundColor: T.panel, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.panelEdge,
    padding: 18, marginBottom: T.gap,
  },
  cardLabel: { color: T.faint, fontSize: 11, fontWeight: '800', letterSpacing: 1 },
  cardMeta: { color: T.faint, fontSize: 13, lineHeight: 19, marginTop: 8 },
  big: { fontSize: 44, fontWeight: '800', marginTop: 6, letterSpacing: -1 },
  vin: { color: T.text, fontSize: 20, fontFamily: F.mono, marginTop: 8, letterSpacing: 1 },

  monitor: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 9, borderBottomWidth: 1, borderBottomColor: T.panelEdge,
  },
  monitorName: { color: T.text, fontSize: 15 },
  monitorState: { fontSize: 14, fontWeight: '700' },
});
