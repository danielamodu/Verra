/** ProofPay mobile theme — one palette, big readable states. */
export const colors = {
  bg: "#0B1020",
  card: "#141B33",
  cardBorder: "#232C4D",
  text: "#F2F5FF",
  muted: "#9AA3C0",
  primary: "#2FD47E",
  primaryText: "#06130C",
  amber: "#F5B544",
  blue: "#57A6FF",
  green: "#2FD47E",
  red: "#FF6B6B",
  danger: "#FF6B6B",
};

export const spacing = { xs: 6, sm: 10, md: 16, lg: 24, xl: 32 };

export type JobStatusKind =
  | "LOCKED"
  | "VERIFYING"
  | "VERIFIED"
  | "RELEASED"
  | "REJECTED"
  | "OPEN";

export function statusColor(kind: JobStatusKind): string {
  switch (kind) {
    case "LOCKED":
      return colors.amber;
    case "VERIFYING":
      return colors.blue;
    case "VERIFIED":
      return colors.green;
    case "RELEASED":
      return colors.green;
    case "REJECTED":
      return colors.red;
    case "OPEN":
      return colors.muted;
  }
}
