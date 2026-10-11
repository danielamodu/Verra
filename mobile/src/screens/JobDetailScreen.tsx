import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useFocusEffect, useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { StatusBadge } from "../components/StatusBadge";
import { PrimaryButton } from "../components/PrimaryButton";
import { TopBar, Tile, SectionLabel, Divider } from "../components/ui";
import { colors, spacing, t } from "../theme";
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

  useFocusEffect(React.useCallback(() => { refresh().catch(() => undefined); }, [refresh]));

  if (!job) {
    return (<Screen><TopBar title="Job" onBack={() => nav.goBack()} /><Text style={t.sub}>Job not found.</Text></Screen>);
  }
  const status = chainStatus(job.chainState);
  const photoReq = job.requirements.find((r) => r.type === "PHOTO_EVIDENCE");
  const photoTotal = photoReq && typeof (photoReq.configuration as { minPhotos?: unknown }).minPhotos === "number"
    ? (photoReq.configuration as { minPhotos: number }).minPhotos : 0;
  const itemTotal = job.requirements.filter((r) => r.type === "CHECKLIST")
    .map((r) => (r.configuration as { items?: unknown[] }).items?.length ?? 0).reduce((a, b) => a + b, 0);

  const accept = async () => {
    setError(null); setBusy(true);
    try { await acceptJob(job.id, address ?? job.worker); }
    catch (e: any) { setError(e?.message ?? "Could not accept the job."); }
    finally { setBusy(false); }
  };

  return (
    <Screen scroll>
      <TopBar title="Job" onBack={() => nav.goBack()} right={<StatusBadge kind={status.kind} label={status.label} />} />
      <Tile>
        <Text style={t.label}>PAYMENT ON COMPLETION</Text>
        <Text style={[t.big, { fontSize: 40, marginTop: 6 }]}>{formatUSDC(job.paymentBaseUnits)}</Text>
        <Text style={[t.sub, { marginTop: 6 }]}>{job.title} · USDC</Text>
      </Tile>
      <Text style={[t.sub, { marginTop: 16 }]}>{job.description}</Text>

      <SectionLabel style={{ marginTop: 24 }}>Requirements · {itemTotal} checks · {photoTotal} photos</SectionLabel>
      {job.requirements.map((r, i) => (
        <View key={r.id}>
          {i > 0 ? <Divider /> : null}
          <Text style={t.item}>{r.label}{r.required ? "" : "  (optional)"}</Text>
        </View>
      ))}

      <SectionLabel style={{ marginTop: 24 }}>Parties</SectionLabel>
      <Text style={t.meta}>Business · {truncateAddress(job.business, 6)}</Text>
      <Text style={[t.meta, { marginTop: 4 }]}>Worker · {truncateAddress(job.worker, 6)}</Text>

      {error ? <Text style={s.error}>{error}</Text> : null}

      <View style={{ height: spacing.lg }} />
      {job.chainState === "FUNDED" ? <PrimaryButton title="Start job" onPress={accept} loading={busy} /> : null}
      {job.chainState === "IN_PROGRESS" ? <PrimaryButton title="Execute job" onPress={() => nav.navigate("ExecuteJob", { jobId: job.id })} /> : null}
      {["SUBMITTED", "VERIFIED", "REJECTED", "SETTLED"].includes(job.chainState) ? (
        <PrimaryButton title="View verification" onPress={() => nav.navigate("Verification", { jobId: job.id })} />
      ) : null}
      <PrimaryButton title="Activity" tone="quiet" onPress={() => nav.navigate("Activity", { jobId: job.id })} />
    </Screen>
  );
}

const s = StyleSheet.create({
  error: { color: colors.red, fontSize: 14, marginTop: spacing.md },
});
