import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { PrimaryButton } from "../components/PrimaryButton";
import { TopBar, SectionLabel, Tile, Chip, Spacer } from "../components/ui";
import { BondBadge } from "../components/BondBadge";
import { colors, radius, font, t } from "../theme";
import { useWallet } from "../wallet/WalletContext";
import { BondClient, SKR_DECIMALS, formatSkr, minBondBaseUnits, skrMint, type BondView } from "../backend/BondClient";
import type { RootStackParamList } from "../navigation/types";

/** Verifier staking — post a mock-SKR bond to be authorized to verify.
 *  All balances labelled "mock SKR (test)". See docs/skr-bond.md. */
export function StakeScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { address, demoMode } = useWallet();
  const [client] = useState(() => new BondClient());
  const [bond, setBond] = useState<BondView | null>(null);
  const [amount, setAmount] = useState("100");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try { setBond(await client.readBond(address)); }
    catch (e: any) { setErr(e?.message ?? "Could not read bond."); }
    finally { setLoading(false); }
  }, [address, client]);

  useEffect(() => { void refresh(); }, [refresh]);

  const onStake = useCallback(async () => {
    if (!address) return;
    setErr(null); setMsg(null);
    const parsed = Number(amount);
    if (!Number.isFinite(parsed) || parsed <= 0) { setErr("Enter a positive amount."); return; }
    const baseUnits = BigInt(Math.round(parsed * 10 ** SKR_DECIMALS));
    setBusy(true);
    try {
      const sig = await client.stake(address, baseUnits);
      setMsg(`Staked. Signature: ${sig.slice(0, 16)}…`);
      await refresh();
    } catch (e: any) { setErr(e?.message ?? "Stake failed."); }
    finally { setBusy(false); }
  }, [address, amount, client, refresh]);

  const min = minBondBaseUnits();
  const configured = Boolean(skrMint());
  const notice =
    !address ? "Connect a wallet to view and post a bond."
      : demoMode ? "Demo mode has no on-chain wallet. Connect a real wallet (devnet) to stake."
      : !configured ? "SKR mint not configured in this build. Staking is disabled until the mock-SKR mint is set."
      : null;

  return (
    <Screen>
      <TopBar title="Verifier bond" onBack={() => nav.goBack()} />
      <Text style={t.sub}>
        Stake SKR to be trusted to verify work. A dispute lets the arbiter slash it — honesty with skin in the game. This is <Text style={{ color: colors.amber, fontFamily: font.bold }}>mock SKR (test)</Text>, not real SKR.
      </Text>

      {notice ? (
        <Text style={[t.sub, { color: colors.amber, marginTop: 20 }]}>{notice}</Text>
      ) : (
        <>
          <View style={{ marginTop: 20, minHeight: 34, justifyContent: "center" }}>
            {loading ? <ActivityIndicator color={colors.lilacInk} /> : <BondBadge bond={bond} />}
          </View>
          <SectionLabel style={{ marginTop: 22 }}>Amount · mock SKR</SectionLabel>
          <TextInput value={amount} onChangeText={setAmount} keyboardType="numeric" editable={!busy} style={s.input} placeholderTextColor={colors.faint} />
          {min > 0n ? <Text style={[t.meta, { marginTop: 8 }]}>Minimum bond: {formatSkr(min)} mock SKR</Text> : null}
          <Tile style={{ marginTop: 18, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
            <Text style={{ color: colors.lilacInk, fontFamily: font.bold, fontSize: 14 }}>Arbiter can slash on dispute</Text>
            <Chip tone="lilac" style={{ backgroundColor: "#fff" }}>on-chain</Chip>
          </Tile>
        </>
      )}

      {msg ? <Text style={[t.meta, { color: colors.green, marginTop: 16 }]}>{msg}</Text> : null}
      {err ? <Text style={[t.meta, { color: colors.red, marginTop: 16 }]}>{err}</Text> : null}
      <Spacer />
      {!notice ? <PrimaryButton title={busy ? "Staking…" : "Stake bond"} onPress={onStake} loading={busy} /> : null}
    </Screen>
  );
}

const s = StyleSheet.create({
  input: { backgroundColor: colors.surface, borderColor: colors.line, borderWidth: 1.5, borderRadius: radius.sm, padding: 14, color: colors.ink, fontFamily: font.black, fontSize: 28, marginTop: 10 },
});
