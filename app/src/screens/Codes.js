import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, Alert, StyleSheet,
} from 'react-native';
import { useStore } from '../store.js';
import { T, F } from '../theme.js';

export default function Codes() {
  const s = useStore();
  const [ranOnce, setRanOnce] = useState(false);

  useEffect(() => {
    if (s.phase === 'ready' && !s.codes && !ranOnce) {
      setRanOnce(true);
      s.refreshCodes();
    }
  }, [s.phase, s.codes, ranOnce]);

  if (s.phase !== 'ready') return <Empty text="Connect an adapter first." />;

  const total =
    (s.codes?.stored.length || 0) +
    (s.codes?.pending.length || 0) +
    (s.codes?.permanent.length || 0);

  const confirmClear = () =>
    Alert.alert(
      'Clear all codes?',
      'This turns off the check engine light and erases freeze-frame data and the emissions readiness monitors. ' +
        'If the underlying fault is still present the code comes straight back. ' +
        'Your car will fail an emissions test until the monitors refill, which takes a few days of mixed driving.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Clear codes', style: 'destructive', onPress: () => s.clearCodes() },
      ],
    );

  return (
    <ScrollView contentContainerStyle={st.pad}>
      <View style={st.headerRow}>
        <Text style={st.h1}>Fault Codes</Text>
        {s.codesLoading && <ActivityIndicator color={T.accent} />}
      </View>

      {s.error ? <Text style={st.err}>{s.error}</Text> : null}

      {s.codes && total === 0 && (
        <View style={[st.card, { borderColor: T.ok }]}>
          <Text style={[st.clean, { color: T.ok }]}>No fault codes stored</Text>
          <Text style={st.meta}>
            The engine control module is not reporting any powertrain or
            emissions faults.
          </Text>
        </View>
      )}

      <Group title="STORED" note="Confirmed faults. These are what turn the light on." items={s.codes?.stored} />
      <Group title="PENDING" note="Seen once. Turns into a stored code if it happens again." items={s.codes?.pending} />
      <Group title="PERMANENT" note="Set by the ECU. Cannot be cleared by any scan tool — they clear themselves once the fault stays fixed." items={s.codes?.permanent} />

      <Pressable style={st.btn} onPress={() => s.refreshCodes()}>
        <Text style={st.btnText}>Re-scan</Text>
      </Pressable>

      <Pressable style={[st.btn, st.btnDanger]} onPress={confirmClear}>
        <Text style={[st.btnText, { color: T.bad }]}>Clear codes &amp; reset light</Text>
      </Pressable>

      <Text style={st.footnote}>
        Generic OBD-II reaches the engine and transmission only. Air suspension,
        ABS, the transfer case and the body modules on this truck sit on
        Land Rover–specific diagnostics that a passthrough adapter cannot read.
      </Text>
    </ScrollView>
  );
}

function Group({ title, note, items }) {
  if (!items || items.length === 0) return null;
  return (
    <View style={{ marginBottom: 18 }}>
      <Text style={st.groupTitle}>{title}</Text>
      <Text style={st.groupNote}>{note}</Text>
      {items.map((c) => (
        <View key={c.code} style={st.card}>
          <View style={st.codeRow}>
            <Text style={st.code}>{c.code}</Text>
            {c.manufacturerSpecific && <Text style={st.tag}>LAND ROVER</Text>}
          </View>
          <Text style={st.desc}>{c.description}</Text>
          {!c.known && (
            <Text style={st.meta}>
              Not in this app's code table — search this exact code with
              "Land Rover" for the factory definition.
            </Text>
          )}
        </View>
      ))}
    </View>
  );
}

function Empty({ text }) {
  return (
    <View style={st.empty}>
      <Text style={st.emptyText}>{text}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 40 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  h1: { color: T.text, fontSize: 28, fontWeight: '700' },

  groupTitle: { color: T.faint, fontSize: 11, fontWeight: '800', letterSpacing: 1, marginBottom: 3 },
  groupNote: { color: T.faint, fontSize: 12, lineHeight: 17, marginBottom: 10 },

  card: {
    backgroundColor: T.panel, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.panelEdge,
    padding: 16, marginBottom: T.gap,
  },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  code: { color: T.text, fontSize: 26, fontWeight: '800', fontFamily: F.mono, letterSpacing: 1 },
  tag: { color: T.warn, fontSize: 10, fontWeight: '800', letterSpacing: 0.5 },
  desc: { color: T.text, fontSize: 16, lineHeight: 22, marginTop: 8 },
  meta: { color: T.faint, fontSize: 13, lineHeight: 19, marginTop: 8 },
  clean: { fontSize: 22, fontWeight: '700' },

  btn: {
    backgroundColor: T.accent, borderRadius: T.radius,
    paddingVertical: 16, alignItems: 'center', marginTop: 8,
  },
  btnDanger: { backgroundColor: 'transparent', borderWidth: 1, borderColor: T.bad },
  btnText: { color: '#04202B', fontSize: 17, fontWeight: '700' },

  err: {
    color: T.bad, fontSize: 15, lineHeight: 21, marginBottom: 14,
    backgroundColor: '#2A1416', borderRadius: T.radius, padding: 14,
  },
  footnote: { color: T.faint, fontSize: 12, lineHeight: 18, marginTop: 24 },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { color: T.faint, fontSize: 16 },
});
