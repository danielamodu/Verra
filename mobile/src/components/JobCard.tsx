import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, t } from "../theme";
import { formatUSDC } from "../lib/format";
import { chainStatus } from "../lib/status";
import { statusColor } from "../theme";
import type { ProofpayJob } from "../backend/types";

/** Clean list row: tinted mark · title + status · amount. Borderless; the
 *  parent list separates rows with <Divider/>. */
export function JobCard({ job, onPress }: { job: ProofpayJob; onPress: () => void }) {
  const status = chainStatus(job.chainState);
  return (
    <TouchableOpacity accessibilityRole="button" onPress={onPress} activeOpacity={0.7} style={styles.row}>
      <View style={styles.icon}>
        <Text style={styles.iconText}>{(job.title || "·").charAt(0).toUpperCase()}</Text>
      </View>
      <View style={styles.mid}>
        <Text style={styles.title} numberOfLines={1}>{job.title}</Text>
        <Text style={[styles.status, { color: statusColor(status.kind) }]} numberOfLines={1}>
          {status.label}
        </Text>
      </View>
      <Text style={styles.amount}>{formatUSDC(job.paymentBaseUnits)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 4 },
  icon: { width: 42, height: 42, borderRadius: 12, backgroundColor: colors.lilacTint, alignItems: "center", justifyContent: "center" },
  iconText: { ...t.item, color: colors.lilacInk, fontSize: 18 },
  mid: { flex: 1 },
  title: { ...t.item },
  status: { ...t.meta, marginTop: 2 },
  amount: { ...t.amount, fontSize: 19 },
});
