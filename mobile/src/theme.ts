/**
 * Verra brand theme — white base, lilac accent, black ink.
 * Geometric type (Outfit). Clean, Apple-HIG-inspired: whitespace + hierarchy,
 * minimal borders, one accent color.
 */
import { Platform } from "react-native";

export const colors = {
  // brand
  bg: "#FFFFFF",
  surface: "#FAFAFB",
  ink: "#0A0A0B",
  muted: "#6B6B73",
  faint: "#A6A4AE",
  line: "#F0EEF4",
  lilac: "#E2A9F1",
  lilacTint: "#F7EBFC",
  lilacInk: "#7A1FB8",
  green: "#1FA86A",
  greenTint: "#E7F6EF",
  amber: "#C98A1E",
  amberTint: "#FBF1DF",
  red: "#E0484D",
  // back-compat aliases (older screens still import these)
  card: "#FFFFFF",
  cardBorder: "#F0EEF4",
  text: "#0A0A0B",
  primary: "#0A0A0B",
  primaryText: "#FFFFFF",
  blue: "#7A1FB8",
  danger: "#E0484D",
};

export const spacing = { xs: 6, sm: 10, md: 16, lg: 24, xl: 32 };
export const radius = { sm: 14, md: 20, pill: 999 };

export const font = {
  regular: "Outfit_400Regular",
  medium: "Outfit_500Medium",
  semibold: "Outfit_600SemiBold",
  bold: "Outfit_700Bold",
  black: "Outfit_800ExtraBold",
  mono: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }) as string,
};

/** Text style presets — the whole app's typography lives here. */
export const t = {
  hero: { fontFamily: font.black, fontSize: 33, letterSpacing: -1.1, color: colors.ink, lineHeight: 36 },
  big: { fontFamily: font.black, fontSize: 46, letterSpacing: -1.8, color: colors.ink },
  title: { fontFamily: font.bold, fontSize: 17, letterSpacing: -0.3, color: colors.ink },
  h2: { fontFamily: font.black, fontSize: 24, letterSpacing: -0.6, color: colors.ink },
  body: { fontFamily: font.regular, fontSize: 15, color: colors.ink },
  sub: { fontFamily: font.regular, fontSize: 15, color: colors.muted, lineHeight: 22 },
  item: { fontFamily: font.semibold, fontSize: 16, color: colors.ink },
  meta: { fontFamily: font.regular, fontSize: 13, color: colors.muted },
  label: { fontFamily: font.bold, fontSize: 11, letterSpacing: 1.1, color: colors.faint },
  amount: { fontFamily: font.black, fontSize: 18, letterSpacing: -0.3, color: colors.ink },
  mono: { fontFamily: font.mono, fontSize: 12, color: colors.muted },
} as const;

export type JobStatusKind = "LOCKED" | "VERIFYING" | "VERIFIED" | "RELEASED" | "REJECTED" | "OPEN";

export function statusColor(kind: JobStatusKind): string {
  switch (kind) {
    case "LOCKED": return colors.amber;
    case "VERIFYING": return colors.lilacInk;
    case "VERIFIED":
    case "RELEASED": return colors.green;
    case "REJECTED": return colors.red;
    case "OPEN": return colors.muted;
  }
}

/** Tint background for a status chip. */
export function statusTint(kind: JobStatusKind): string {
  switch (kind) {
    case "LOCKED": return colors.amberTint;
    case "VERIFYING": return colors.lilacTint;
    case "VERIFIED":
    case "RELEASED": return colors.greenTint;
    case "REJECTED": return "#FBE9EA";
    case "OPEN": return colors.surface;
  }
}
