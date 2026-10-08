/** JSON serialization: BigInt amounts → numbers (safe-range enforced). */
export function serialize<T>(value: T): any {
  return JSON.parse(
    JSON.stringify(value, (_key, v) =>
      typeof v === "bigint" ? Number(v) : v
    )
  );
}
