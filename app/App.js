import React, { useState } from 'react';
import {
  View, Text, Pressable, StatusBar, SafeAreaView, StyleSheet, Platform,
} from 'react-native';
import Connect from './src/screens/Connect.js';
import Codes from './src/screens/Codes.js';
import Live from './src/screens/Live.js';
import { useStore } from './src/store.js';
import { T } from './src/theme.js';

// ponytail: three screens don't justify a navigation library. A tab index and
// a switch is the whole router. Upgrade path is react-navigation if this ever
// needs deep links or a stack.
const TABS = [
  { key: 'connect', label: 'Vehicle', screen: Connect },
  { key: 'codes', label: 'Codes', screen: Codes },
  { key: 'live', label: 'Live', screen: Live },
];

export default function App() {
  const [tab, setTab] = useState(0);
  const phase = useStore((s) => s.phase);
  const milOn = useStore((s) => s.status?.milOn);
  const Screen = TABS[tab].screen;

  return (
    <View style={st.root}>
      <StatusBar barStyle="light-content" backgroundColor={T.bg} />
      <SafeAreaView style={st.safe}>
        <View style={st.titlebar}>
          <Text style={st.title}>SCANNER</Text>
          <View style={st.status}>
            <View
              style={[
                st.dot,
                { backgroundColor: phase === 'ready' ? (milOn ? T.bad : T.ok) : T.faint },
              ]}
            />
            <Text style={st.statusText}>
              {phase === 'ready' ? 'CONNECTED' : phase.toUpperCase()}
            </Text>
          </View>
        </View>

        <View style={{ flex: 1 }}>
          <Screen />
        </View>

        <View style={st.tabs}>
          {TABS.map((t, i) => (
            <Pressable key={t.key} style={st.tab} onPress={() => setTab(i)}>
              <Text style={[st.tabLabel, i === tab && st.tabLabelOn]}>{t.label}</Text>
              {i === tab && <View style={st.tabBar} />}
            </Pressable>
          ))}
        </View>
      </SafeAreaView>
    </View>
  );
}

const st = StyleSheet.create({
  root: { flex: 1, backgroundColor: T.bg },
  safe: { flex: 1 },

  titlebar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: Platform.OS === 'android' ? 12 : 4, paddingBottom: 10,
  },
  title: { color: T.text, fontSize: 13, fontWeight: '900', letterSpacing: 3 },
  status: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  statusText: { color: T.faint, fontSize: 10, fontWeight: '800', letterSpacing: 1 },

  tabs: {
    flexDirection: 'row',
    borderTopWidth: 1, borderTopColor: T.panelEdge,
    backgroundColor: T.bg,
  },
  tab: { flex: 1, alignItems: 'center', paddingTop: 14, paddingBottom: 10 },
  tabLabel: { color: T.faint, fontSize: 13, fontWeight: '700', letterSpacing: 0.5 },
  tabLabelOn: { color: T.text },
  tabBar: {
    position: 'absolute', top: 0, height: 2, width: 34,
    backgroundColor: T.accent, borderRadius: 2,
  },
});
