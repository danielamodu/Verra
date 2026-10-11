import { StyleSheet, Text, View } from "react-native";
import { statusColor, statusTint, font, type JobStatusKind } from "../theme";

/** Small pill: tinted background + colored label. Clean, borderless. */
export function StatusBadge({ kind, label }: { kind: JobStatusKind; label?: string }) {
  const color = statusColor(kind);
  return (
    <View style={[styles.badge, { backgroundColor: statusTint(kind) }]}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={[styles.text, { color }]}>{(label ?? kind).toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 11,
  },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  text: { fontSize: 11, fontFamily: font.bold, letterSpacing: 0.6 },
});
