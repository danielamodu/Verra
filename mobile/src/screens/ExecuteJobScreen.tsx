import React, { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { colors, spacing } from "../theme";
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
    return (
      <Screen>
        <Text style={styles.muted}>Job not found.</Text>
      </Screen>
    );
  }

  const toggle = (id: string) =>
    setDone((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const ready = done.length >= checklistReqs.length && checklistReqs.length > 0;

  return (
    <Screen>
      <Text style={styles.heading}>{job.title}</Text>
      <Text style={styles.sub}>
        {done.length}/{checklistReqs.length} complete
      </Text>

      {checklistReqs.map((r) => (
        <TouchableOpacity
          key={r.id}
          accessibilityRole="checkbox"
          onPress={() => toggle(r.id)}
          style={[styles.check, done.includes(r.id) && styles.checkDone]}
        >
          <View style={[styles.box, done.includes(r.id) && styles.boxDone]}>
            {done.includes(r.id) ? <Text style={styles.tick}>✓</Text> : null}
          </View>
          <Text style={styles.checkLabel}>{r.label}</Text>
        </TouchableOpacity>
      ))}

      <PrimaryButton
        title="Capture evidence"
        disabled={!ready}
        onPress={() => nav.navigate("Evidence", { jobId: job.id, completedChecklists: done })}
      />
      {!ready ? (
        <Text style={styles.hint}>Complete every checklist item to unlock the camera.</Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { color: colors.text, fontSize: 22, fontWeight: "800" },
  sub: { color: colors.primary, fontSize: 18, fontWeight: "800", marginTop: 4 },
  muted: { color: colors.muted, fontSize: 14 },
  check: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.card,
    borderColor: colors.cardBorder, borderWidth: 1, borderRadius: 14,
    padding: spacing.md, marginTop: spacing.sm, minHeight: 64,
  },
  checkDone: { borderColor: colors.primary },
  box: {
    width: 34, height: 34, borderRadius: 10, borderWidth: 2, borderColor: colors.muted,
    alignItems: "center", justifyContent: "center", marginRight: spacing.sm,
  },
  boxDone: { backgroundColor: colors.primary, borderColor: colors.primary },
  tick: { color: colors.primaryText, fontWeight: "800", fontSize: 20 },
  checkLabel: { color: colors.text, fontSize: 16, flex: 1 },
  hint: { color: colors.muted, fontSize: 13, marginTop: spacing.sm, textAlign: "center" },
});
