import React, { useEffect, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { TopBar, Tile, Chip, Divider, BrandLockup, VerraMark, Spacer } from "../components/ui";
import { colors, font, t } from "../theme";
import { buildReceiptView, type ReceiptView } from "../lib/receipt";
import { attachVerifySignature, attachWorkerSignature, buildAttestation } from "../../../verification/attestation";
import { explorerUrl } from "../backend/SolanaBackend";
import { useProofpay } from "../state/ProofpayContext";
import { useWallet } from "../wallet/WalletContext";
import type { RootStackParamList } from "../navigation/types";

/** The Verra Receipt — the shareable artifact of verified work. */
export function ReceiptScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, "Receipt">>();
  const { jobs, getSubmission } = useProofpay();
  const { deviceId } = useWallet();
  const job = jobs.find((j) => j.id === route.params.jobId);
  const [view, setView] = useState<ReceiptView | null>(null);

  useEffect(() => {
    if (!job?.verification) return;
    getSubmission(job.submissionId ?? job.id)
      .then((submission) => {
        if (!submission) return;
        let att = buildAttestation({ result: job.verification!, submission, verifier: "demo-verifier", deviceId: deviceId ?? undefined });
        if ((submission as any).worker_signature) att = attachWorkerSignature(att, (submission as any).worker_signature);
        const sig = job.settlement?.real ? job.settlement.signature ?? null : null;
        if (sig && job.settlement?.verifySignature) att = attachVerifySignature(att, job.settlement.verifySignature);
        setView(buildReceiptView(job.title, `#${job.id.slice(-6)}`, att, sig, job.paymentBaseUnits));
      })
      .catch(() => undefined);
  }, [job?.id]);

  if (!job) {
    return (<Screen><TopBar title="Receipt" onBack={() => nav.goBack()} /><Text style={t.sub}>Job not found.</Text></Screen>);
  }
  const settled = view?.demo === false;

  return (
    <Screen scroll>
      <TopBar title="Receipt" right={<VerraMark size={24} />} />
      <Tile>
        <Chip tone={settled ? "green" : "amber"} style={{ backgroundColor: "#fff" }}>● {view?.stateLabel ?? job.chainState}</Chip>
        <Text style={[t.big, { marginTop: 16 }]}>{view?.amount ?? ""}</Text>
        <Text style={[t.sub, { marginTop: 8 }]}>USDC → worker {view?.workerShort ?? job.worker.slice(0, 3) + "…"}</Text>
      </Tile>

      <View style={{ height: 22 }} />
      {view?.lines.map((l, i) => (
        <View key={l.label}>
          {i > 0 ? <Divider /> : null}
          <View style={s.row}>
            <Text style={[t.item, { flex: 1 }]}>{l.label}</Text>
            <View style={[s.mark, { backgroundColor: l.ok ? colors.green : colors.red }]}><Text style={s.markText}>{l.ok ? "✓" : "✗"}</Text></View>
          </View>
        </View>
      ))}

      <Spacer />
      {view?.txShort ? (
        <PrimaryButton title="View on Solana Explorer" tone="quiet"
          onPress={() => job.settlement?.signature && Linking.openURL(explorerUrl(job.settlement.signature))} />
      ) : (
        <Text style={[t.meta, { textAlign: "center", color: colors.amber, marginTop: 8 }]}>Demo receipt — no on-chain transaction.</Text>
      )}
      <PrimaryButton title="Done" onPress={() => nav.popToTop()} />
      <View style={{ height: 14 }} />
      <View style={{ opacity: 0.4, alignItems: "center" }}><BrandLockup size={13} center /></View>
    </Screen>
  );
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", paddingVertical: 4 },
  mark: { width: 24, height: 24, borderRadius: 8, alignItems: "center", justifyContent: "center" },
  markText: { color: "#fff", fontFamily: font.bold, fontSize: 13 },
});
