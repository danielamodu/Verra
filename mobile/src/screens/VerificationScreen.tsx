import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { StatusBadge } from "../components/StatusBadge";
import { PrimaryButton } from "../components/PrimaryButton";
import { colors, spacing } from "../theme";
import { useProofpay } from "../state/ProofpayContext";
import type { RootStackParamList } from "../navigation/types";

const STEPS = ["Submitted", "Checking requirements", "Decision"] as const;

export function VerificationScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Verification">>();
  const { jobs, getSubmission } = useProofpay();
  const job = jobs.find((j) => j.id === route.params.jobId);
  const [visibleChecks, setVisibleChecks] = useState(0);
  const [fingerprints, setFingerprints] = useState<string[]>([]);

  useEffect(() => {
    if (!job) return;
    // Submissions are keyed by submissionId server-side (see /api/submissions/:id).
    getSubmission(job.submissionId ?? job.id)
      .then((s) => setFingerprints(s?.evidence.map((e) => e.content_hash) ?? []))
      .catch(() => undefined);
  }, [job?.id]);

  const result = job?.verification;
  const totalSteps = result ? STEPS.length : 1;

  useEffect(() => {
    setVisibleChecks(0);
    if (!result) return;
    if (result.checks.length === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    result.checks.forEach((_, i) => {
      timers.push(setTimeout(() => setVisibleChecks(i + 1), 600 * (i + 1)));
    });
    return () => timers.forEach(clearTimeout);
  }, [result?.submission_id]);

  if (!job) {
    return (
      <Screen>
        <Text style={styles.muted}>Job not found.</Text>
      </Screen>
    );
  }

  const done = result ? visibleChecks >= result.checks.length : false;
  const verdict = done ? result!.status : null;

  return (
    <Screen>
      <Text style={styles.heading}>Verification</Text>
      {STEPS.slice(0, totalSteps).map((step, i) => {
        const active = i === 0 || (result != null && (i < 2 || done));
        return (
          <View key={step} style={styles.stepRow}>
            <View style={[styles.rail, active && styles.railActive]} />
            <Text style={[styles.step, active && styles.stepActive]}>{step}</Text>
          </View>
        );
      })}

      {result?.checks.slice(0, visibleChecks).map((c) => (
        <View key={c.requirement} style={styles.checkRow}>
          <Text style={[styles.mark, c.passed ? styles.pass : styles.fail]}>
            {c.passed ? "✓" : "✗"}
          </Text>
          <View style={styles.checkBody}>
            <Text style={styles.checkReq}>{c.requirement}</Text>
            <Text style={styles.checkReason}>{c.reason}</Text>
          </View>
        </View>
      ))}

      {done && fingerprints.length > 0 ? (
        <View style={styles.fpBox}>
          <Text style={styles.fpTitle}>✓ Evidence fingerprints</Text>
          {fingerprints.map((h, i) => (
            <Text key={i} style={styles.fpHash} numberOfLines={1}>
              ⛓ {h.slice(0, 20)}…
            </Text>
          ))}
        </View>
      ) : null}

      {verdict ? (
        <View style={styles.verdict}>
          <StatusBadge kind={verdict === "VERIFIED" ? "VERIFIED" : "REJECTED"} />
          <Text style={styles.reason}>{result!.reason}</Text>
        </View>
      ) : null}

      {verdict === "VERIFIED" ? (
        <PrimaryButton
          title="Continue to settlement"
          onPress={() => nav.navigate("Settlement", { jobId: job.id })}
        />
      ) : null}
      {verdict === "REJECTED" ? (
        <PrimaryButton
          title="Fix and resubmit"
          onPress={() => nav.navigate("ExecuteJob", { jobId: job.id })}
        />
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { color: colors.text, fontSize: 22, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 14 },
  stepRow: { flexDirection: "row", alignItems: "center", marginTop: spacing.md },
  rail: { width: 4, height: 28, borderRadius: 2, backgroundColor: colors.cardBorder, marginRight: spacing.sm },
  railActive: { backgroundColor: colors.blue },
  step: { color: colors.muted, fontSize: 17, fontWeight: "700" },
  stepActive: { color: colors.text },
  checkRow: {
    flexDirection: "row", backgroundColor: colors.card, borderColor: colors.cardBorder,
    borderWidth: 1, borderRadius: 12, padding: spacing.sm, marginTop: spacing.sm,
  },
  mark: { fontSize: 20, fontWeight: "800", marginRight: spacing.sm },
  pass: { color: colors.green },
  fail: { color: colors.red },
  checkBody: { flex: 1 },
  fpBox: {
    backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: 1,
    borderRadius: 12, padding: spacing.sm, marginTop: spacing.sm,
  },
  fpTitle: { color: colors.green, fontSize: 14, fontWeight: "800" },
  fpHash: { color: colors.muted, fontSize: 12, marginTop: 2 },
  checkReq: { color: colors.text, fontSize: 14, fontWeight: "700" },
  checkReason: { color: colors.muted, fontSize: 13, marginTop: 2 },
  verdict: { marginTop: spacing.lg, gap: spacing.sm },
  reason: { color: colors.muted, fontSize: 14 },
});
