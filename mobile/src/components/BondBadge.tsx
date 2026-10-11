import { StyleSheet, Text, View } from "react-native";
import { colors, spacing } from "../theme";
import { formatSkr, type BondView } from "../backend/BondClient";

/**
 * Shows a verifier's SKR bond status. Presentational only — the parent fetches
 * the BondView via BondClient and passes it in, so this is reusable on the
 * Stake, Verification, and Receipt screens.
 *
 * The amount is always labelled "mock SKR (test)" — never official SKR.
 */
export function BondBadge({ bond }: { bond: BondView | null }) {
  if (!bond || !bond.exists) {
    return (
      <View style={[styles.badge, { borderColor: colors.amber, backgroundColor: `${colors.amber}1A` }]}>
        <Text style={[styles.text, { color: colors.amber }]}>⚠ Verifier not bonded</Text>
      </View>
    );
  }
  const ok = bond.sufficient;
  const color = ok ? colors.green : colors.amber;
  const label = ok
    ? `✓ Verifier bonded — ${formatSkr(bond.amount)} mock SKR (test)`
    : `⚠ Bond below minimum — ${formatSkr(bond.amount)} mock SKR (test)`;
  return (
    <View style={[styles.badge, { borderColor: color, backgroundColor: `${color}1A` }]}>
      <Text style={[styles.text, { color }]}>{label}</Text>
      {bond.locked && <Text style={styles.locked}>locked (dispute)</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    alignSelf: "flex-start",
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  text: { fontSize: 13, fontWeight: "800" },
  locked: { color: colors.muted, fontSize: 11, marginTop: 2 },
});
