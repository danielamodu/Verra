import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { TopBar, Chip } from "../components/ui";
import { colors, font, t } from "../theme";
import { useProofpay } from "../state/ProofpayContext";
import type { RootStackParamList } from "../navigation/types";

const STAGE_ORDER = ["created", "funded", "accepted", "submitted", "verified", "released"] as const;

interface TimelineItem { key: string; label: string; at: string; }

export function ActivityScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Activity">>();
  const { jobs, backend } = useProofpay();
  const job = jobs.find((j) => j.id === route.params.jobId);
  const [remote, setRemote] = useState<TimelineItem[] | null>(null);

  useEffect(() => {
    if (!job || typeof backend.getActivity !== "function") return;
    backend.getActivity(job.id).then((events) => { if (events.length > 0) setRemote(events); }).catch(() => undefined);
  }, [job?.id]);

  if (!job) {
    return (<Screen><TopBar title="Activity" onBack={() => nav.goBack()} /><Text style={t.sub}>Job not found.</Text></Screen>);
  }

  const order = (key: string) => {
    const i = STAGE_ORDER.findIndex((s) => key.toLowerCase().startsWith(s));
    return i === -1 ? 99 : i;
  };
  const source: TimelineItem[] = remote ?? job.activity.map((a) => ({ key: a.key, label: a.label, at: a.at }));
  const events = [...source].sort((a, b) => order(a.key) - order(b.key));
  const last = events.length - 1;

  return (
    <Screen scroll>
      <TopBar title="Activity" onBack={() => nav.goBack()} />
      {remote ? <Chip tone="green" style={{ marginBottom: 16 }}>Synced from Verra backend</Chip> : null}
      {events.map((e, i) => {
        const released = e.key.toLowerCase().startsWith("released") || /release/i.test(e.label);
        return (
          <View key={`${e.key}-${i}`} style={s.row}>
            <View style={s.rail}>
              <View style={[s.dot, released && { backgroundColor: colors.green }]} />
              {i < last ? <View style={s.line} /> : null}
            </View>
            <View style={s.body}>
              <Text style={[t.item, released && { color: colors.green }]}>{e.label}</Text>
              <Text style={[t.meta, { marginTop: 2 }]}>{new Date(e.at).toLocaleString()}</Text>
            </View>
          </View>
        );
      })}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row" },
  rail: { alignItems: "center", marginRight: 14, width: 12 },
  dot: { width: 11, height: 11, borderRadius: 6, backgroundColor: colors.lilac, marginTop: 4 },
  line: { width: 2, flex: 1, backgroundColor: colors.line, marginVertical: 2 },
  body: { paddingBottom: 20, flex: 1 },
});
