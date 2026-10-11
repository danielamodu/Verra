import React, { useState } from "react";
import { StyleSheet, Text } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { RouteProp } from "@react-navigation/native";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { TopBar, Steps, Tile, Chip, Spacer } from "../components/ui";
import { colors, t } from "../theme";
import { formatUSDC, truncateAddress } from "../lib/format";
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
    return (<Screen><TopBar title="Settlement" onBack={() => nav.goBack()} /><Text style={t.sub}>Job not found.</Text></Screen>);
  }

  const settle = async () => {
    setError(null); setBusy(true);
    try {
      if (backendKind === "devnet") await requestSettlement(job.id);
      else await releasePayment(job.id);
      nav.replace("Receipt", { jobId: job.id });
    } catch (e: any) { setError(e?.message ?? "Settlement failed."); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <TopBar title="Settlement" onBack={() => nav.goBack()} />
      <Steps total={5} current={5} />
      <Tile>
        <Text style={t.label}>RELEASING FROM ESCROW</Text>
        <Text style={[t.big, { fontSize: 44, marginTop: 6 }]}>{formatUSDC(job.paymentBaseUnits)}</Text>
        <Text style={[t.sub, { marginTop: 6 }]}>USDC → worker {truncateAddress(job.worker, 6)}</Text>
      </Tile>
      <Chip tone="green" style={{ marginTop: 18 }}>✓ Only a bonded verifier can release</Chip>
      <Text style={[t.sub, { marginTop: 12 }]}>
        {backendKind === "demo"
          ? "Demo mode records a non-on-chain receipt. Real USDC moves only via the devnet backend + verifier signatures."
          : "The backend verifies the attestation, signs verify_job with the verifier key, and releases escrow. Both signatures appear on the receipt."}
      </Text>
      {error ? <Text style={s.error}>{error}</Text> : null}
      <Spacer />
      <PrimaryButton title={`Release ${formatUSDC(job.paymentBaseUnits)}`} onPress={settle} loading={busy} />
    </Screen>
  );
}

const s = StyleSheet.create({ error: { color: colors.red, fontSize: 14, marginTop: 12 } });
