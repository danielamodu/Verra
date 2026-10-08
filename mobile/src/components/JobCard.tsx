import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, spacing } from "../theme";
import { formatUSDC } from "../lib/format";
import { chainStatus } from "../lib/status";
import { StatusBadge } from "./StatusBadge";
import type { ProofpayJob } from "../backend/types";

export function JobCard({ job, onPress }: { job: ProofpayJob; onPress: () => void }) {
  const status = chainStatus(job.chainState);
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} style={styles.card}>
      <View style={styles.row}>
        <Text style={styles.title} numberOfLines={1}>
          {job.title}
        </Text>
        <StatusBadge kind={status.kind} label={status.label} />
      </View>
      <Text style={styles.amount}>{formatUSDC(job.paymentBaseUnits)}</Text>
      <Text style={styles.desc} numberOfLines={2}>
        {job.description}
      </Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: 16,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  title: { color: colors.text, fontSize: 17, fontWeight: "700", flex: 1, marginRight: spacing.sm },
  amount: { color: colors.primary, fontSize: 26, fontWeight: "800", marginTop: spacing.xs },
  desc: { color: colors.muted, fontSize: 14, marginTop: 4 },
});
