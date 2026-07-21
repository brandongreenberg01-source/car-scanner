import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from 'react-native';
import { useStore } from '../store.js';
import { PIDS, DEFAULT_LIVE_PIDS } from '../obd/pids.js';
import { T, F } from '../theme.js';

export default function Live() {
  const s = useStore();
  const { width } = useWindowDimensions();

  // Poll only what this car actually answers, in the order we care about.
  const pids = DEFAULT_LIVE_PIDS.filter((p) => s.supportedPids.includes(p));
  const list = pids.length ? pids : DEFAULT_LIVE_PIDS;

  useEffect(() => {
    if (s.phase !== 'ready') return;
    s.startLive(list);
    return () => s.stopLive();
  }, [s.phase, list.join(',')]);

  if (s.phase !== 'ready') {
    return (
      <View style={st.empty}>
        <Text style={st.emptyText}>Connect an adapter first.</Text>
      </View>
    );
  }

  // Two columns on a phone, three once there's room.
  const cols = width > 560 ? 3 : 2;
  const cardWidth = (width - 32 - T.gap * (cols - 1)) / cols;

  return (
    <ScrollView contentContainerStyle={st.pad}>
      <Text style={st.h1}>Live Data</Text>
      <View style={st.grid}>
        {list.map((pid) => (
          <Gauge key={pid} pid={pid} reading={s.live[pid]} width={cardWidth} />
        ))}
      </View>
      <Text style={st.footnote}>
        Values refresh in rotation. A cheap adapter answers roughly ten requests
        a second in total, so more gauges means each one updates less often.
      </Text>
    </ScrollView>
  );
}

function Gauge({ pid, reading, width }) {
  const def = PIDS[pid];
  const value = reading?.value;
  const has = typeof value === 'number';
  const warn = has && def.warn?.(value);

  // Fewer decimals as the number gets bigger — 3000 rpm, but 13.8 volts.
  const shown = !has ? '—'
    : Math.abs(value) >= 100 ? Math.round(value).toString()
    : Math.abs(value) >= 10 ? value.toFixed(1)
    : value.toFixed(2);

  return (
    <View style={[st.card, { width }, warn && { borderColor: T.warn }]}>
      <Text style={st.label} numberOfLines={1}>{def.name.toUpperCase()}</Text>
      <Text style={[st.value, warn && { color: T.warn }, !has && { color: T.faint }]}>
        {shown}
      </Text>
      <Text style={st.unit}>{def.unit}</Text>
    </View>
  );
}

const st = StyleSheet.create({
  pad: { padding: 16, paddingBottom: 40 },
  h1: { color: T.text, fontSize: 28, fontWeight: '700', marginBottom: 14 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: T.gap },

  card: {
    backgroundColor: T.panel, borderRadius: T.radius,
    borderWidth: 1, borderColor: T.panelEdge,
    paddingVertical: 16, paddingHorizontal: 14,
  },
  label: { color: T.faint, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 },
  value: {
    color: T.text, fontSize: 34, fontWeight: '700',
    fontFamily: F.mono, marginTop: 8, letterSpacing: -1,
  },
  unit: { color: T.dim, fontSize: 12, marginTop: 2 },

  footnote: { color: T.faint, fontSize: 12, lineHeight: 18, marginTop: 20 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 40 },
  emptyText: { color: T.faint, fontSize: 16 },
});
