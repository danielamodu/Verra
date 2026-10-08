import React, { useEffect, useState } from "react";
import { Linking, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { colors, spacing } from "../theme";
import { buildReceiptView, type ReceiptView } from "../lib/receipt";
import {
  attachVerifySignature,
  attachWorkerSignature,
  buildAttestation,
} from "../../../verification/attestation";
import { explorerUrl } from "../backend/SolanaBackend";
import { useProofpay } from "../state/ProofpayContext";
import { useWallet } from "../wallet/WalletContext";
import type { RootStackParamList } from "../navigation/types";

/**
 * The Verra Receipt — the shareable artifact of verified work.
 * Built from the stored submission + engine result (+ real signatures when
 * settlement happened on-chain). Demo receipts are explicitly badged.
 */
export function ReceiptScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Receipt">>();
  const { jobs, getSubmission } = useProofpay();
  const { deviceId } = useWallet();
  const job = jobs.find((j) => j.id === route.params.jobId);
  const [view, setView] = useState<ReceiptView | null>(null);

  useEffect(() => {
    if (!job?.verification) return;
    getSubmission(job.id)
      .then((submission) => {
        if (!submission) return;
        let att = buildAttestation({
          result: job.verification!,
          submission,
          verifier: "demo-verifier",
          deviceId: deviceId ?? undefined,
        });
        if ((submission as any).worker_signature) {
          att = attachWorkerSignature(att, (submission as any).worker_signature);
        }
        const sig = job.settlement?.real ? job.settlement.signature ?? null : null;
        if (sig && job.settlement?.verifySignature) {
          att = attachVerifySignature(att, job.settlement.verifySignature);
        }
        setView(
          buildReceiptView(job.title, `#${job.id.slice(-6)}`, att, sig, job.paymentBaseUnits)
        );
      })
      .catch(() => undefined);
  }, [job?.id]);

  if (!job) {
    return (
      <Screen>
        <Text style={styles.muted}>Job not found.</Text>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={styles.card}>
        <Text style={styles.brand}>VERRA RECEIPT</Text>
        <Text style={styles.jobTitle}>{view?.title ?? job.title.toUpperCase()}</Text>
        <Text style={styles.jobRef}>STORE INSPECTION {view?.jobRef ?? `#${job.id.slice(-6)}`}</Text>
        <Text style={styles.worker}>Worker{"\n"}{view?.workerShort ?? job.worker.slice(0, 3) + "…"}</Text>
        {view?.lines.map((l) => (
          <Text key={l.label} style={styles.line}>
            {l.ok ? "✓" : "✗"} {l.label}
          </Text>
        ))}
        <Text style={styles.amount}>{view?.amount ?? ""}</Text>
        <Text style={[styles.state, view?.demo === false ? styles.settled : styles.pending]}>
          {view?.stateLabel ?? job.chainState}
        </Text>
        {view?.txShort ? (
          <TouchableOpacity
            accessibilityRole="link"
            onPress={() =>
              job.settlement?.signature && Linking.openURL(explorerUrl(job.settlement.signature))
            }
          >
            <Text style={styles.link}>Solana transaction{"\n"}{view.txShort} ↗</Text>
          </TouchableOpacity>
        ) : (
          <Text style={styles.demoNote}>Demo receipt — no on-chain transaction.</Text>
        )}
      </View>
      <PrimaryButton title="Done" tone="quiet" onPress={() => nav.popToTop()} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  muted: { color: colors.muted, fontSize: 14, textAlign: "center" },
  card: {
    backgroundColor: colors.card, borderColor: colors.primary, borderWidth: 2,
    borderRadius: 20, padding: spacing.lg, alignItems: "center",
  },
  brand: { color: colors.primary, fontSize: 15, fontWeight: "800", letterSpacing: 3 },
  jobTitle: { color: colors.text, fontSize: 24, fontWeight: "800", marginTop: spacing.sm, textAlign: "center" },
  jobRef: { color: colors.muted, fontSize: 13, fontWeight: "700", letterSpacing: 1, marginTop: 2 },
  worker: { color: colors.text, fontSize: 16, fontWeight: "700", textAlign: "center", marginTop: spacing.md },
  line: { color: colors.text, fontSize: 15, marginTop: 6 },
  amount: { color: colors.primary, fontSize: 38, fontWeight: "800", marginTop: spacing.md },
  state: { fontSize: 18, fontWeight: "800", letterSpacing: 2, marginTop: 4 },
  settled: { color: colors.green },
  pending: { color: colors.amber },
  link: { color: colors.blue, fontSize: 15, marginTop: spacing.md, fontWeight: "700", textAlign: "center" },
  demoNote: { color: colors.amber, fontSize: 13, marginTop: spacing.md, textAlign: "center" },
});
