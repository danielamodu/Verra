/** USDC has 6 decimals: 150_000_000 base units = $150.00. */
export const USDC_DECIMALS = 6;

export function formatUSDC(baseUnits: number): string {
  const whole = Math.trunc(baseUnits / 10 ** USDC_DECIMALS);
  const frac = String(baseUnits % 10 ** USDC_DECIMALS).padStart(USDC_DECIMALS, "0").slice(0, 2);
  return `$${whole.toLocaleString("en-US")}.${frac} USDC`;
}

export function formatSignedUSDC(baseUnits: number): string {
  return `+${formatUSDC(baseUnits)}`;
}

/** Parse "$150", "150", "150.00" → base units. Throws on invalid input. */
export function parseUSDC(input: string): number {
  const cleaned = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,6})?$/.test(cleaned)) {
    throw new Error("Enter an amount like 150 or 150.00");
  }
  const [w, f = ""] = cleaned.split(".");
  const units = Number(w) * 10 ** USDC_DECIMALS + Number((f + "000000").slice(0, 6));
  if (!Number.isSafeInteger(units) || units <= 0) {
    throw new Error("Amount must be greater than zero");
  }
  return units;
}

export function truncateAddress(address: string, chars = 4): string {
  if (address.length <= chars * 2 + 3) return address;
  return `${address.slice(0, chars)}…${address.slice(-chars)}`;
}
