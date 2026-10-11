import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { TopBar, Steps, Divider, Chip, Spacer } from "../components/ui";
import { colors, font, t } from "../theme";
import { truncateAddress } from "../lib/format";
import { bytesToBase64, hexToBytes } from "../lib/encoding";
import { submissionCommitment } from "../../../verification/attestation";
import { submissionFromDraft } from "../backend/types";
import { useProofpay } from "../state/ProofpayContext";
import { useWallet } from "../wallet/WalletContext";
import type { RootStackParamList } from "../navigation/types";

export function ReviewScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Review">>();
  const { jobs, submitCompletion } = useProofpay();
  const { address, demoMode, deviceId, signWithWallet } = useWallet();
  const job = jobs.find((j) => j.id === route.params.jobId);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!job) {
    return (<Screen><TopBar title="Review" onBack={() => nav.goBack()} /><Text style={t.sub}>Job not found.</Text></Screen>);
  }
  const { completedChecklists, photos } = route.params;

  const submit = async () => {
    setError(null); setBusy(true);
    try {
      const submissionId = `sub-${Date.now()}`;
      let workerSignature: string | undefined;
      const canSign = !demoMode && address && address === job.worker;
      if (canSign && address) {
        const commitment = submissionCommitment(
          submissionFromDraft(job, job.worker, submissionId, completedChecklists, photos, new Date().toISOString(), deviceId ?? undefined)
        );
        workerSignature = bytesToBase64(await signWithWallet(hexToBytes(commitment)));
      }
      await submitCompletion(job.id, { submissionId, completedChecklists, evidence: photos, deviceId: deviceId ?? undefined, workerSignature });
      nav.replace("Verification", { jobId: job.id });
    } catch (e: any) { setError(e?.message ?? "Could not submit work."); }
    finally { setBusy(false); }
  };

  const Row = ({ title, sub }: { title: string; sub: string }) => (
    <View style={s.row}>
      <View style={{ flex: 1 }}>
        <Text style={t.item}>{title}</Text>
        <Text style={[t.meta, { marginTop: 2 }]}>{sub}</Text>
      </View>
      <View style={s.tick}><Text style={s.tickText}>✓</Text></View>
    </View>
  );

  return (
    <Screen>
      <TopBar title="Review" onBack={() => nav.goBack()} />
      <Steps total={5} current={3} />
      <Row title="Checklist" sub={`Complete · ${completedChecklists.length} requirement(s)`} />
      <Divider />
      <Row title="Evidence" sub={`${photos.length} photo(s) · hashed on device`} />
      <Divider />
      <Row title="Worker" sub={address ? truncateAddress(address, 6) : "unknown"} />
      {!demoMode ? <Chip tone="lilac" style={{ marginTop: 18 }}>Seed Vault will sign this submission</Chip> : null}
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Spacer />
      <PrimaryButton title={demoMode ? "Submit work" : "Sign & submit work"} onPress={submit} loading={busy} />
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 4, minHeight: 44 },
  tick: { width: 24, height: 24, borderRadius: 8, backgroundColor: colors.green, alignItems: "center", justifyContent: "center" },
  tickText: { color: "#fff", fontFamily: font.bold, fontSize: 13 },
  error: { color: colors.red, fontSize: 14, marginTop: 12 },
});
