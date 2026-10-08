import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { StatusBadge } from "../components/StatusBadge";
import { PrimaryButton } from "../components/PrimaryButton";
import { colors, spacing } from "../theme";
import { formatUSDC, truncateAddress } from "../lib/format";
import { chainStatus } from "../lib/status";
import { useProofpay } from "../state/ProofpayContext";
import { useWallet } from "../wallet/WalletContext";
import type { RootStackParamList } from "../navigation/types";

export function JobDetailScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "JobDetail">>();
  const { jobs, refresh, acceptJob } = useProofpay();
  const { address } = useWallet();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const job = jobs.find((j) => j.id === route.params.jobId);

  useFocusEffect(
    React.useCallback(() => {
      refresh().catch(() => undefined);
    }, [refresh])
  );

  if (!job) {
    return (
      <Screen>
        <Text style={styles.muted}>Job not found.</Text>
      </Screen>
    );
  }
  const status = chainStatus(job.chainState);
  const photoReq = job.requirements.find((r) => r.type === "PHOTO_EVIDENCE");
  const photoTotal =
    photoReq && typeof (photoReq.configuration as { minPhotos?: unknown }).minPhotos === "number"
      ? (photoReq.configuration as { minPhotos: number }).minPhotos
      : 0;
  const itemTotal = job.requirements
    .filter((r) => r.type === "CHECKLIST")
    .map((r) => (r.configuration as { items?: unknown[] }).items?.length ?? 0)
    .reduce((a, b) => a + b, 0);

  const accept = async () => {
    setError(null);
    setBusy(true);
    try {
      await acceptJob(job.id, address ?? job.worker);
    } catch (e: any) {
      setError(e?.message ?? "Could not accept the job.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.headRow}>
        <Text style={styles.title}>{job.title}</Text>
        <StatusBadge kind={status.kind} label={status.label} />
      </View>
      <Text style={styles.amount}>{formatUSDC(job.paymentBaseUnits)}</Text>
      <Text style={styles.desc}>{job.description}</Text>

      <Text style={styles.section}>Requirements</Text>
      <Text style={styles.progress}>
        0/{itemTotal} complete{"\n"}0/{photoTotal} photos
      </Text>
      {job.requirements.map((r) => (
        <Text key={r.id} style={styles.req}>
          • {r.label} {r.required ? "" : "(optional)"}
        </Text>
      ))}

      <Text style={styles.section}>Parties</Text>
      <Text style={styles.muted}>Business: {truncateAddress(job.business, 6)}</Text>
      <Text style={styles.muted}>Worker: {truncateAddress(job.worker, 6)}</Text>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {job.chainState === "FUNDED" ? (
        <PrimaryButton title="Start job" onPress={accept} loading={busy} />
      ) : null}
      {job.chainState === "IN_PROGRESS" ? (
        <PrimaryButton
          title="Execute job"
          onPress={() => nav.navigate("ExecuteJob", { jobId: job.id })}
        />
      ) : null}
      {job.chainState === "SUBMITTED" ||
      job.chainState === "VERIFIED" ||
      job.chainState === "REJECTED" ||
      job.chainState === "SETTLED" ? (
        <PrimaryButton
          title="View verification"
          onPress={() => nav.navigate("Verification", { jobId: job.id })}
        />
      ) : null}
      <PrimaryButton
        title="Activity"
        tone="quiet"
        onPress={() => nav.navigate("Activity", { jobId: job.id })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  headRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: colors.text, fontSize: 22, fontWeight: "800", flex: 1, marginRight: spacing.sm },
  amount: { color: colors.primary, fontSize: 34, fontWeight: "800", marginTop: spacing.sm },
  desc: { color: colors.muted, fontSize: 15, marginTop: 4 },
  section: { color: colors.text, fontSize: 16, fontWeight: "800", marginTop: spacing.lg },
  progress: { color: colors.primary, fontSize: 20, fontWeight: "800", marginTop: 4 },
  req: { color: colors.text, fontSize: 14, marginTop: 4 },
  muted: { color: colors.muted, fontSize: 14, marginTop: 2 },
  error: { color: colors.red, fontSize: 14, marginTop: spacing.sm },
});
