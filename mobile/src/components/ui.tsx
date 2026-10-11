import React from "react";
import { Image, StyleSheet, Text, TouchableOpacity, View, ViewStyle } from "react-native";
import { colors, spacing, radius, font, t } from "../theme";

const MARK_BLACK = require("../../assets/brand/mark-black.png");
const MARK_WHITE = require("../../assets/brand/mark-white.png");

/** Pushes following content to the bottom of a flex Screen. */
export function Spacer() {
  return <View style={{ flex: 1 }} />;
}

/** The Verra mark (transparent, tintable). */
export function VerraMark({ size = 28, tint = "black" }: { size?: number; tint?: "black" | "white" }) {
  return (
    <Image
      source={tint === "white" ? MARK_WHITE : MARK_BLACK}
      style={{ width: size, height: size }}
      resizeMode="contain"
    />
  );
}

/** mark + "verra" wordmark. */
export function BrandLockup({ size = 22, center = false, tint = "black" }: { size?: number; center?: boolean; tint?: "black" | "white" }) {
  return (
    <View style={[styles.lockup, center && { justifyContent: "center" }]}>
      <VerraMark size={size * 1.15} tint={tint} />
      <Text style={[styles.word, { fontSize: size, color: tint === "white" ? "#fff" : colors.ink }]}>verra</Text>
    </View>
  );
}

/** Top bar: optional back, title, optional right slot. */
export function TopBar({ title, onBack, right }: { title?: string; onBack?: () => void; right?: React.ReactNode }) {
  return (
    <View style={styles.topbar}>
      {onBack ? (
        <TouchableOpacity accessibilityRole="button" onPress={onBack} style={styles.back}>
          <Text style={styles.backText}>‹</Text>
        </TouchableOpacity>
      ) : null}
      {title ? <Text style={styles.tbtitle}>{title}</Text> : null}
      <View style={{ flex: 1 }} />
      {right}
    </View>
  );
}

// PLACEHOLDER

type ChipTone = "lilac" | "green" | "amber" | "neutral";
const CHIP: Record<ChipTone, { bg: string; fg: string }> = {
  lilac: { bg: colors.lilacTint, fg: colors.lilacInk },
  green: { bg: colors.greenTint, fg: colors.green },
  amber: { bg: colors.amberTint, fg: colors.amber },
  neutral: { bg: colors.surface, fg: colors.muted },
};

export function Chip({ tone = "lilac", children, style }: { tone?: ChipTone; children: React.ReactNode; style?: ViewStyle }) {
  const c = CHIP[tone];
  return (
    <View style={[styles.chip, { backgroundColor: c.bg }, style]}>
      <Text style={[styles.chipText, { color: c.fg }]}>{children}</Text>
    </View>
  );
}

export function SectionLabel({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <Text style={[t.label, styles.seclabel, style]}>{String(children).toUpperCase()}</Text>;
}

export function Divider() {
  return <View style={styles.divline} />;
}

/** Soft lilac block for hero/amount/callouts. */
export function Tile({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  return <View style={[styles.tile, style]}>{children}</View>;
}

/** Progress dots for the worker flow. `current` is 1-based; done < current. */
export function Steps({ total, current }: { total: number; current: number }) {
  return (
    <View style={styles.steps}>
      {Array.from({ length: total }).map((_, i) => {
        const n = i + 1;
        const bg = n < current ? colors.ink : n === current ? colors.lilac : colors.line;
        return <View key={i} style={[styles.step, { backgroundColor: bg }]} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  lockup: { flexDirection: "row", alignItems: "center", gap: 8 },
  word: { fontFamily: font.black, letterSpacing: -0.8 },
  topbar: { flexDirection: "row", alignItems: "center", gap: 10, height: 34, marginBottom: spacing.md },
  back: { width: 32, height: 32, borderRadius: 9, backgroundColor: colors.surface, alignItems: "center", justifyContent: "center" },
  backText: { fontSize: 20, color: colors.ink, fontFamily: font.bold },
  tbtitle: { ...t.title },
  chip: { alignSelf: "flex-start", borderRadius: 999, paddingVertical: 7, paddingHorizontal: 13 },
  chipText: { fontFamily: font.bold, fontSize: 12.5, letterSpacing: 0.1 },
  seclabel: { marginBottom: 12 },
  divline: { height: 1, backgroundColor: colors.line, marginVertical: 13 },
  tile: { backgroundColor: colors.lilacTint, borderRadius: radius.md, padding: 20 },
  steps: { flexDirection: "row", gap: 5, marginBottom: 20 },
  step: { height: 4, flex: 1, borderRadius: 2 },
});

