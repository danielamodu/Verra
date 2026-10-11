import { StyleSheet, Text, TouchableOpacity, ActivityIndicator, ViewStyle } from "react-native";
import { colors, spacing, radius, font } from "../theme";

export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
  tone = "primary",
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: "primary" | "lilac" | "quiet";
}) {
  const bg =
    tone === "lilac" ? styles.lilac : tone === "quiet" ? styles.quiet : styles.primary;
  const label =
    tone === "quiet" ? styles.quietLabel : tone === "lilac" ? styles.lilacLabel : styles.primaryLabel;
  const spinner = tone === "primary" ? "#fff" : colors.ink;
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      activeOpacity={0.85}
      disabled={disabled || loading}
      style={[styles.base, bg, (disabled || loading) && styles.disabled] as ViewStyle[]}
    >
      {loading ? (
        <ActivityIndicator color={spinner} />
      ) : (
        <Text style={[styles.label, label]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: radius.md,
    paddingVertical: 17,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    marginTop: spacing.sm,
  },
  primary: { backgroundColor: colors.ink },
  lilac: { backgroundColor: colors.lilac },
  quiet: { backgroundColor: colors.bg, borderWidth: 1.5, borderColor: colors.line },
  disabled: { opacity: 0.4 },
  label: { fontSize: 16, fontFamily: font.bold, letterSpacing: -0.2 },
  primaryLabel: { color: "#FFFFFF" },
  lilacLabel: { color: "#20102C" },
  quietLabel: { color: colors.ink },
});
