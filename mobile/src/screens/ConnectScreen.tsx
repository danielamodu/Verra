import { StyleSheet, Text, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { colors, spacing } from "../theme";
import { truncateAddress } from "../lib/format";
import { homeRouteFor, useWallet } from "../wallet/WalletContext";
import { useProofpay } from "../state/ProofpayContext";
import type { RootStackParamList } from "../navigation/types";

export function ConnectScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { address, demoMode, connecting, error, connect, connectDemo, role } = useWallet();
  const { backendKind, useBackend } = useProofpay();

  const go = () => nav.replace("Role");

  const enableDevnet = () => {
    // Real on-chain mode needs a funded devnet wallet + backend API.
    // Switches the app client; every transaction then requires wallet approval.
    useBackend("devnet");
  };

  return (
    <Screen>
      <View style={styles.logoWrap}>
        <View style={styles.mark}>
          <Text style={styles.markText}>V</Text>
        </View>
        <Text style={styles.name}>VERA</Text>
        <Text style={styles.tag}>Verified work. Paid automatically.</Text>
      </View>

      {address ? (
        <View style={styles.walletBox}>
          <Text style={styles.walletLabel}>{demoMode ? "Demo wallet" : "Connected wallet"}</Text>
          <Text style={styles.walletAddr}>{truncateAddress(address, 6)}</Text>
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {address ? (
        <PrimaryButton title="Continue" onPress={go} />
      ) : (
        <>
          <PrimaryButton title={connecting ? "Waiting for wallet…" : "Connect wallet"} onPress={connect} loading={connecting} />
          <PrimaryButton title="Continue without wallet (demo)" onPress={() => connectDemo(role)} tone="quiet" />
        </>
      )}
      <Text style={styles.hint}>
        Signing happens in your wallet app (Seed Vault compatible). Verra never sees your keys.
      </Text>
      {backendKind === "demo" ? (
        <PrimaryButton title="Use devnet backend (needs funded wallet)" tone="quiet" onPress={enableDevnet} />
      ) : (
        <Text style={styles.hint}>Backend: Solana devnet. <Text style={styles.link} onPress={() => useBackend("demo")}>Back to demo</Text></Text>
      )}
      {!demoMode && address ? (
        <Text style={styles.hint}>Connected as {truncateAddress(address, 6)}.</Text>
      ) : null}
      <Text style={styles.hint}>Next: choose a role to enter as {homeRouteFor(role)} demo.</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  logoWrap: { alignItems: "center", marginTop: spacing.xl, marginBottom: spacing.lg },
  mark: {
    width: 72, height: 72, borderRadius: 20, backgroundColor: colors.primary,
    alignItems: "center", justifyContent: "center",
  },
  markText: { color: colors.primaryText, fontSize: 36, fontWeight: "800" },
  name: { color: colors.text, fontSize: 32, fontWeight: "800", marginTop: spacing.sm, letterSpacing: 4 },
  tag: { color: colors.muted, fontSize: 15, textAlign: "center", marginTop: 4 },
  walletBox: {
    backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: 1,
    borderRadius: 14, padding: spacing.md, marginBottom: spacing.md, alignItems: "center",
  },
  walletLabel: { color: colors.muted, fontSize: 13 },
  walletAddr: { color: colors.text, fontSize: 18, fontWeight: "700", marginTop: 2 },
  error: { color: colors.red, fontSize: 14, marginTop: spacing.sm },
  hint: { color: colors.muted, fontSize: 13, textAlign: "center", marginTop: spacing.sm },
  link: { color: colors.blue, fontWeight: "700" },
});
