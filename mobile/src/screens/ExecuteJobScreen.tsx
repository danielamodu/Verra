import React, { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { TopBar, Steps, Divider } from "../components/ui";
import { colors, font, t } from "../theme";
import { useProofpay } from "../state/ProofpayContext";
import type { RootStackParamList } from "../navigation/types";

export function ExecuteJobScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "ExecuteJob">>();
  const { jobs } = useProofpay();
  const job = jobs.find((j) => j.id === route.params.jobId);
  const [done, setDone] = useState<string[]>([]);

  const checklistReqs = useMemo(
    () => job?.requirements.filter((r) => r.type === "CHECKLIST") ?? [],
    [job]
  );

  if (!job) {
    return (<Screen><TopBar title="Checklist" onBack={() => nav.goBack()} /><Text style={t.sub}>Job not found.</Text></Screen>);
  }

  const toggle = (id: string) =>
    setDone((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const ready = done.length >= checklistReqs.length && checklistReqs.length > 0;

  return (
    <Screen>
      <TopBar title="Checklist" onBack={() => nav.goBack()} />
      <Steps total={5} current={1} />
      <Text style={[t.meta, { marginBottom: 8 }]}>{done.length}/{checklistReqs.length} complete</Text>
      <View style={{ flex: 1 }}>
        {checklistReqs.map((r, i) => {
          const on = done.includes(r.id);
          return (
            <View key={r.id}>
              {i > 0 ? <Divider /> : null}
              <TouchableOpacity accessibilityRole="checkbox" onPress={() => toggle(r.id)} style={s.row} activeOpacity={0.7}>
                <Text style={[t.item, { flex: 1 }]}>{r.label}</Text>
                {on ? <View style={s.tick}><Text style={s.tickText}>✓</Text></View> : <View style={s.ring} />}
              </TouchableOpacity>
            </View>
          );
        })}
      </View>
      <PrimaryButton title="Capture evidence" disabled={!ready} onPress={() => nav.navigate("Evidence", { jobId: job.id, completedChecklists: done })} />
      {!ready ? <Text style={[t.meta, { textAlign: "center", marginTop: 8 }]}>Complete every item to unlock the camera.</Text> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 4, minHeight: 44 },
  tick: { width: 24, height: 24, borderRadius: 8, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  tickText: { color: "#fff", fontFamily: font.bold, fontSize: 13 },
  ring: { width: 24, height: 24, borderRadius: 8, borderWidth: 2, borderColor: colors.line },
});
