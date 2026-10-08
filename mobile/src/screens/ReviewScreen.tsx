import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { colors, spacing } from "../theme";
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
    return (
      <Screen>
        <Text style={styles.muted}>Job not found.</Text>
      </Screen>
    );
  }
  const { completedChecklists, photos } = route.params;

  const submit = async () => {
    setError(null);
    setBusy(true);
    try {
      const submissionId = `sub-${Date.now()}`;
      // Bind worker identity: the wallet signs the submission commitment
      // (job + worker + checklist + evidence hashes). In demo mode there is
      // no wallet session, so the submission travels unsigned.
      let workerSignature: string | undefined;
      const canSign = !demoMode && address && address === job.worker;
      if (canSign && address) {
        const commitment = submissionCommitment(
          submissionFromDraft(
            job,
            job.worker,
            submissionId,
            completedChecklists,
            photos,
            new Date().toISOString(),
            deviceId ?? undefined
          )
        );
        workerSignature = bytesToBase64(
          await signWithWallet(hexToBytes(commitment))
        );
      }
      await submitCompletion(job.id, {
        submissionId,
        completedChecklists,
        evidence: photos,
        deviceId: deviceId ?? undefined,
        workerSignature,
      });
      nav.replace("Verification", { jobId: job.id });
    } catch (e: any) {
      setError(e?.message ?? "Could not submit work.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Text style={styles.heading}>Review</Text>
      <View style={styles.row}>
        <Text style={styles.mark}>✓</Text>
        <View>
          <Text style={styles.rowTitle}>CHECKLIST</Text>
          <Text style={styles.rowSub}>Complete — {completedChecklists.length} requirement(s)</Text>
        </View>
      </View>
      <View style={styles.row}>
        <Text style={styles.mark}>✓</Text>
        <View>
          <Text style={styles.rowTitle}>EVIDENCE</Text>
          <Text style={styles.rowSub}>✓ {photos.length} photo(s), hashed on-device</Text>
        </View>
      </View>
      <View style={styles.row}>
        <Text style={styles.mark}>✓</Text>
        <View>
          <Text style={styles.rowTitle}>WORKER</Text>
          <Text style={styles.rowSub}>{address ? truncateAddress(address, 6) : "unknown"}</Text>
        </View>
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton
        title={demoMode ? "Submit work" : "Sign & submit work"}
        onPress={submit}
        loading={busy}
      />
      {!demoMode ? (
        <Text style={styles.hint}>Your wallet signs the submission fingerprint.</Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { color: colors.text, fontSize: 22, fontWeight: "800" },
  muted: { color: colors.muted, fontSize: 14 },
  row: {
    flexDirection: "row", alignItems: "center", backgroundColor: colors.card,
    borderColor: colors.cardBorder, borderWidth: 1, borderRadius: 14,
    padding: spacing.md, marginTop: spacing.sm,
  },
  mark: { color: colors.green, fontSize: 24, fontWeight: "800", marginRight: spacing.sm },
  rowTitle: { color: colors.text, fontSize: 15, fontWeight: "800", letterSpacing: 1 },
  rowSub: { color: colors.muted, fontSize: 13, marginTop: 2 },
  error: { color: colors.red, fontSize: 14, marginTop: spacing.sm },
  hint: { color: colors.muted, fontSize: 13, marginTop: spacing.sm, textAlign: "center" },
});
