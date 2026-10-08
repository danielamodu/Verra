import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { StatusBadge } from "../components/StatusBadge";
import { PrimaryButton } from "../components/PrimaryButton";
import { colors, spacing } from "../theme";
import { formatUSDC } from "../lib/format";
import { useProofpay } from "../state/ProofpayContext";
import type { RootStackParamList } from "../navigation/types";

export function SettlementScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Settlement">>();
  const { jobs, backendKind, releasePayment, requestSettlement } = useProofpay();
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

  const settle = async () => {
    setError(null);
    setBusy(true);
    try {
      // Devnet: the backend service (verifier-key holder) verifies + settles.
      // Demo: records an explicitly non-on-chain receipt.
      if (backendKind === "devnet") {
        await requestSettlement(job.id);
      } else {
        await releasePayment(job.id);
      }
      nav.replace("Receipt", { jobId: job.id });
    } catch (e: any) {
      setError(e?.message ?? "Settlement failed.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <View style={styles.hero}>
        <StatusBadge kind="VERIFIED" />
        <Text style={styles.heroAmount}>{formatUSDC(job.paymentBaseUnits)}</Text>
        <Text style={styles.sub}>Verified and ready to settle.</Text>
      </View>
      {backendKind === "demo" ? (
        <View style={styles.demoBox}>
          <Text style={styles.demoText}>
            DEMO — settlement here records a non-on-chain receipt. Real USDC moves
            only via the devnet backend + verifier signatures.
          </Text>
        </View>
      ) : (
        <Text style={styles.body}>
          The backend service verifies the attestation, signs verify_job with the
          verifier key, and releases escrow. You will see both signatures on the receipt.
        </Text>
      )}
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <PrimaryButton title="Settle" onPress={settle} loading={busy} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: "center", marginTop: spacing.xl },
  heroAmount: { color: colors.primary, fontSize: 40, fontWeight: "800", marginVertical: spacing.sm },
  sub: { color: colors.muted, fontSize: 15 },
  muted: { color: colors.muted, fontSize: 14, textAlign: "center" },
  body: { color: colors.muted, fontSize: 15, marginTop: spacing.lg, textAlign: "center" },
  demoBox: {
    borderColor: colors.amber, borderWidth: 1, borderRadius: 12,
    padding: spacing.md, marginTop: spacing.md, backgroundColor: `${colors.amber}14`,
  },
  demoText: { color: colors.amber, fontSize: 13, fontWeight: "700" },
  error: { color: colors.red, fontSize: 14, marginTop: spacing.sm, textAlign: "center" },
});
