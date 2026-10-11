import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { TopBar, Steps, Chip, Divider, SectionLabel } from "../components/ui";
import { colors, font, t } from "../theme";
import { useProofpay } from "../state/ProofpayContext";
import type { RootStackParamList } from "../navigation/types";

export function VerificationScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Verification">>();
  const { jobs, getSubmission } = useProofpay();
  const job = jobs.find((j) => j.id === route.params.jobId);
  const [visibleChecks, setVisibleChecks] = useState(0);
  const [fingerprints, setFingerprints] = useState<string[]>([]);

  useEffect(() => {
    if (!job) return;
    getSubmission(job.submissionId ?? job.id)
      .then((s) => setFingerprints(s?.evidence.map((e) => e.content_hash) ?? []))
      .catch(() => undefined);
  }, [job?.id]);

  const result = job?.verification;
  useEffect(() => {
    setVisibleChecks(0);
    if (!result || result.checks.length === 0) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    result.checks.forEach((_, i) => timers.push(setTimeout(() => setVisibleChecks(i + 1), 600 * (i + 1))));
    return () => timers.forEach(clearTimeout);
  }, [result?.submission_id]);

  if (!job) {
    return (<Screen><TopBar title="Verification" onBack={() => nav.goBack()} /><Text style={t.sub}>Job not found.</Text></Screen>);
  }

  const done = result ? visibleChecks >= result.checks.length : false;
  const verdict = done ? result!.status : null;
  const verified = verdict === "VERIFIED";

  return (
    <Screen scroll>
      <TopBar title="Verification" onBack={() => nav.goBack()} />
      <Steps total={5} current={4} />

      {verdict ? (
        <>
          <Chip tone={verified ? "green" : "amber"} style={{ marginBottom: 12 }}>● {verdict}</Chip>
          <Text style={[t.hero, { fontSize: 26 }]}>{verified ? "All checks\npassed." : "Needs another\npass."}</Text>
          <Text style={[t.sub, { marginTop: 10 }]}>{result!.reason}</Text>
          <View style={{ height: 18 }} />
        </>
      ) : (
        <Text style={[t.sub, { marginBottom: 10 }]}>Checking requirements…</Text>
      )}

      {result?.checks.slice(0, visibleChecks).map((c, i) => (
        <View key={c.requirement}>
          {i > 0 ? <Divider /> : null}
          <View style={s.row}>
            <View style={{ flex: 1 }}>
              <Text style={t.item}>{c.requirement}</Text>
              <Text style={[t.meta, { marginTop: 2 }]}>{c.reason}</Text>
            </View>
            <View style={[s.mark, { backgroundColor: c.passed ? colors.green : colors.red }]}>
              <Text style={s.markText}>{c.passed ? "✓" : "✗"}</Text>
            </View>
          </View>
        </View>
      ))}

      {done && fingerprints.length > 0 ? (
        <>
          <SectionLabel style={{ marginTop: 22 }}>Evidence fingerprints</SectionLabel>
          {fingerprints.map((h, i) => (<Text key={i} style={s.fp} numberOfLines={1}>⛓ {h.slice(0, 24)}…</Text>))}
        </>
      ) : null}

      <View style={{ height: 20 }} />
      {verdict === "VERIFIED" ? <PrimaryButton title="Settle payment" onPress={() => nav.navigate("Settlement", { jobId: job.id })} /> : null}
      {verdict === "REJECTED" ? <PrimaryButton title="Fix and resubmit" onPress={() => nav.navigate("ExecuteJob", { jobId: job.id })} /> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  mark: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  markText: { color: "#fff", fontFamily: font.bold, fontSize: 13 },
  fp: { fontFamily: font.mono, fontSize: 12, color: colors.muted, marginTop: 4 },
});
