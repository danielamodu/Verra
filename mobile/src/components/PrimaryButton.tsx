import { StyleSheet, Text, TouchableOpacity, ActivityIndicator, ViewStyle } from "react-native";
import { colors, spacing } from "../theme";

export function PrimaryButton({
  title,
  onPress,
  disabled,
  loading,
  tone,
}: {
  title: string;
  onPress: () => void;
  disabled?: boolean;
  loading?: boolean;
  tone?: "primary" | "quiet";
}) {
  const quiet = tone === "quiet";
  return (
    <TouchableOpacity
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled || loading}
      style={[
        styles.base,
        quiet ? styles.quiet : styles.primary,
        (disabled || loading) && styles.disabled,
      ] as ViewStyle[]}
    >
      {loading ? (
        <ActivityIndicator color={quiet ? colors.text : colors.primaryText} />
      ) : (
        <Text style={[styles.label, quiet ? styles.quietLabel : styles.primaryLabel]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: 14,
    paddingVertical: 16,
    paddingHorizontal: spacing.lg,
    alignItems: "center",
    marginTop: spacing.md,
  },
  primary: { backgroundColor: colors.primary },
  quiet: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.cardBorder },
  disabled: { opacity: 0.45 },
  label: { fontSize: 17, fontWeight: "700" },
  primaryLabel: { color: colors.primaryText },
  quietLabel: { color: colors.text },
});
