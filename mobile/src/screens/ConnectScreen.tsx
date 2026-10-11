import { StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { BrandLockup, Chip, Spacer } from "../components/ui";
import { colors, t } from "../theme";
import { truncateAddress } from "../lib/format";
import { useWallet } from "../wallet/WalletContext";
import { useProofpay } from "../state/ProofpayContext";
import type { RootStackParamList } from "../navigation/types";

export function ConnectScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { address, demoMode, connecting, error, connect, connectDemo, role } = useWallet();
  const { backendKind, useBackend } = useProofpay();

  const go = () => nav.replace("Role");

  return (
    <Screen>
      <View style={{ height: 10 }} />
      <BrandLockup size={22} center />
      <View style={{ height: 34 }} />
      <Text style={t.hero}>Proof of real{"\n"}work, paid{"\n"}on the spot.</Text>
      <Text style={[t.sub, { marginTop: 14 }]}>
        Clock in from your Seeker. The phone signs that you were there. The chain pays the second it's verified.
      </Text>

      {address ? (
        <View style={s.wallet}>
          <Text style={t.label}>{demoMode ? "DEMO WALLET" : "CONNECTED WALLET"}</Text>
          <Text style={[t.item, { marginTop: 2 }]}>{truncateAddress(address, 6)}</Text>
        </View>
      ) : null}
      {error ? <Text style={s.error}>{error}</Text> : null}

      <Spacer />
      <Chip tone="lilac" style={{ marginBottom: 14 }}>◎ Built on Solana Seeker</Chip>
      {address ? (
        <PrimaryButton title="Continue" onPress={go} />
      ) : (
        <>
          <PrimaryButton title={connecting ? "Waiting for wallet…" : "Connect wallet"} onPress={connect} loading={connecting} />
          <PrimaryButton title="Explore demo" tone="quiet" onPress={() => connectDemo(role)} />
        </>
      )}
      {backendKind === "demo" ? (
        <Text style={s.hint} onPress={() => useBackend("devnet")}>Advanced: use devnet backend (needs funded wallet)</Text>
      ) : (
        <Text style={s.hint}>Backend: devnet · <Text style={{ color: colors.lilacInk }} onPress={() => useBackend("demo")}>back to demo</Text></Text>
      )}
    </Screen>
  );
}

const s = StyleSheet.create({
  wallet: { backgroundColor: colors.surface, borderRadius: 14, padding: 14, marginTop: 20 },
  error: { color: colors.red, fontSize: 14, marginTop: 12 },
  hint: { ...t.meta, textAlign: "center", marginTop: 12 },
});
