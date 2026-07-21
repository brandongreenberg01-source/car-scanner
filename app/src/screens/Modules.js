import React from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, StyleSheet,
} from 'react-native';
import { useStore } from '../store.js';
import { T, F } from '../theme.js';

export default function Modules() {
  const s = useStore();

  if (s.phase !== 'ready') {
    return (
      <View style={st.empty}>
        <Text style={st.emptyText}>Connect an adapter first.</Text>
      </View>
    );
  }

  const found = s.modules || [];
  const sweep = s.sweep;

  return (
    <ScrollView contentContainerStyle={st.pad}>
      <Text style={st.h1}>Modules</Text>
      <Text style={st.body}>
        Generic OBD-II only talks to the engine. This addresses each control
        module directly over UDS — the protocol the factory tool uses — and
        reads its own fault memory.
      </Text>

      {sweep?.running ? (
        <>
          <View style={st.progress}>
            <ActivityIndicator color={T.accent} />
            <Text style={st.progressText}>
              {sweep.index + 1} / {sweep.total}  ·  {sweep.current}
            </Text>
          </View>
          <Pressable style={[st.btn, st.btnStop]} onPress={() => s.stopSweep()}>
            <Text style={[st.btnText, { color: T.dim }]}>Stop scan</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Pressable style={st.btn} onPress={() => s.discoverModules()}>
            <Text style={st.btnText}>
              {found.length ? 'Quick scan again' : 'Quick scan'}
            </Text>
          </Pressable>
          <Pressable style={[st.btn, st.btnDeep]} onPress={() => s.discoverModules({ deep: true })}>
            <Text style={[st.btnText, { color: T.accent }]}>Deep scan — every address</Text>
          </Pressable>
          <Text style={st.hint}>
            Quick scan checks 20 likely addresses in seconds. Deep scan probes
            the entire diagnostic block (240 addresses, a few minutes) and will
            find modules sitting at addresses nobody has published for this
            truck. Stoppable at any point.
          </Text>
        </>
      )}

      {s.error ? <Text style={st.err}>{s.error}</Text> : null}

      {!sweep?.running && found.length === 0 && s.sweptOnce && (
        <View style={st.note}>
          <Text style={st.noteText}>
            No modules answered. That usually means the ignition is off, or
            everything else on this truck sits on the medium-speed bus (OBD
            pins 3 and 11) which this adapter cannot reach — only the
            high-speed bus on pins 6 and 14.
          </Text>
        </View>
      )}

      {found.map((m) => (
        <ModuleCard key={m.req} module={m} store={s} />
      ))}

      {found.length > 0 && (
        <Text style={st.footnote}>
          Addresses are probed from a Ford/Jaguar-derived candidate list, since
          the 2010–2012 L322 shares that electrical architecture. Anything
          listed here answered for real; anything absent either isn't at that
          address or isn't on this bus.
        </Text>
      )}
    </ScrollView>
  );
}

function ModuleCard({ module: m, store: s }) {
  const result = s.moduleDtcs?.[m.req];
  const busy = s.moduleBusy === m.req;

  return (
    <View style={st.card}>
      <View style={st.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={st.moduleName}>{m.name}</Text>
          <Text style={st.moduleAddr}>
            {m.req.toString(16).toUpperCase()} → {(m.req + 8).toString(16).toUpperCase()}
          </Text>
        </View>
        <Pressable
          style={st.readBtn}
          disabled={busy}
          onPress={() => s.readModuleDtcs(m.req)}
        >
          {busy
            ? <ActivityIndicator color={T.accent} size="small" />
            : <Text style={st.readBtnText}>Read faults</Text>}
        </Pressable>
      </View>

      {result?.kind === 'negative' && (
        <Text style={st.refused}>
          Module refused: {result.message}
          {result.code === 0x33 && '\nThis one needs security access — a seed/key exchange this app deliberately does not attempt.'}
        </Text>
      )}

      {result?.kind === 'empty' && (
        <Text style={st.refused}>No response to the fault-memory request.</Text>
      )}

      {result?.kind === 'positive' && result.dtcs.length === 0 && (
        <Text style={st.clean}>No faults stored</Text>
      )}

      {result?.kind === 'positive' && result.dtcs.map((d) => (
        <View key={d.fullCode} style={st.dtc}>
          <View style={st.dtcHead}>
            <Text style={st.dtcCode}>{d.fullCode}</Text>
            <Text style={[st.dtcState, { color: d.active ? T.bad : T.dim }]}>
              {d.active ? 'ACTIVE' : 'HISTORIC'}
            </Text>
          </View>
          <Text style={st.dtcDesc}>{d.failureDescription}</Text>
        </View>
      ))}
    </View>
  );
}

const st = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 40 },
  h1: { color: T.text, fontSize: 28, fontWeight: '700', marginBottom: 8 },
  body: { color: T.dim, fontSize: 14, lineHeight: 20, marginBottom: 16 },

  btn: {
    backgroundColor: T.accent, borderRadius: T.radius,
    paddingVertical: 16, alignItems: 'center', marginBottom: 12,
  },
  btnBusy: { backgroundColor: T.panel, borderWidth: 1, borderColor: T.panelEdge },
  btnDeep: { backgroundColor: 'transparent', borderWidth: 1, borderColor: T.accent },
  btnStop: { backgroundColor: 'transparent', borderWidth: 1, borderColor: T.panelEdge },
  btnText: { color: '#04202B', fontSize: 17, fontWeight: '700' },
  hint: { color: T.faint, fontSize: 12, lineHeight: 18, marginBottom: 16 },

  progress: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  progressText: { color: T.dim, fontSize: 13, marginLeft: 10, fontFamily: F.mono },

  card: {
    backgroundColor: T.panel, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.panelEdge,
    padding: 16, marginBottom: T.gap,
  },
  cardHead: { flexDirection: 'row', alignItems: 'center' },
  moduleName: { color: T.text, fontSize: 17, fontWeight: '600' },
  moduleAddr: { color: T.faint, fontSize: 12, fontFamily: F.mono, marginTop: 3 },
  readBtn: {
    borderWidth: 1, borderColor: T.panelEdge, borderRadius: 9,
    paddingHorizontal: 14, paddingVertical: 9, minWidth: 96, alignItems: 'center',
  },
  readBtnText: { color: T.accent, fontSize: 13, fontWeight: '700' },

  clean: { color: T.ok, fontSize: 14, marginTop: 12, fontWeight: '600' },
  refused: { color: T.warn, fontSize: 13, lineHeight: 19, marginTop: 12 },

  dtc: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: T.panelEdge },
  dtcHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dtcCode: { color: T.text, fontSize: 19, fontWeight: '800', fontFamily: F.mono },
  dtcState: { fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  dtcDesc: { color: T.dim, fontSize: 14, marginTop: 4 },

  err: {
    color: T.bad, fontSize: 15, lineHeight: 21, marginBottom: 14,
    backgroundColor: '#2A1416', borderRadius: T.radius, padding: 14,
  },
  note: { marginTop: 8, padding: 14, backgroundColor: T.panel, borderRadius: T.radius },
  noteText: { color: T.faint, fontSize: 13, lineHeight: 19 },
  footnote: { color: T.faint, fontSize: 12, lineHeight: 18, marginTop: 12 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { color: T.faint, fontSize: 16 },
});
