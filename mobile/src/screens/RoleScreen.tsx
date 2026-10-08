import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { Screen } from "../components/Screen";
import { colors, spacing } from "../theme";
import { homeRouteFor, useWallet, type Role } from "../wallet/WalletContext";
import type { RootStackParamList } from "../navigation/types";

export function RoleScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { role, setRole, address, demoMode, connectDemo } = useWallet();

  const pick = (r: Role) => {
    setRole(r);
    // In demo mode without a wallet, mint the role wallet on selection.
    if (!address) connectDemo(r);
    nav.replace(homeRouteFor(r));
  };

  return (
    <Screen>
      <Text style={styles.heading}>I am a…</Text>
      <Text style={styles.sub}>
        {demoMode || !address
          ? "Demo mode — pick a role to explore the full loop."
          : "Choose how to enter Verra."}
      </Text>
      <View style={styles.list}>
        {(["Business", "Worker"] as Role[]).map((r) => (
          <TouchableOpacity
            key={r}
            accessibilityRole="button"
            onPress={() => pick(r)}
            style={[styles.card, role === r && styles.active]}
          >
            <Text style={styles.cardTitle}>{r.toUpperCase()}</Text>
            <Text style={styles.cardSub}>
              {r === "Business" ? "Create jobs, fund $USDC, track settlement." : "Accept work, submit proof, get paid."}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: spacing.xl },
  sub: { color: colors.muted, fontSize: 15, marginTop: 4 },
  list: { marginTop: spacing.lg, gap: spacing.md },
  card: {
    backgroundColor: colors.card, borderColor: colors.cardBorder, borderWidth: 1,
    borderRadius: 16, padding: spacing.lg,
  },
  active: { borderColor: colors.primary },
  cardTitle: { color: colors.text, fontSize: 22, fontWeight: "800", letterSpacing: 2 },
  cardSub: { color: colors.muted, fontSize: 14, marginTop: 4 },
});
