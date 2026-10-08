/** Minimal base64 → bytes decoder (no dependency, works in RN + Node). */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

export function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/=]/g, "");
  if (clean.length % 4 !== 0) throw new Error("Invalid base64 length");
  const eqIndex = clean.indexOf("=");
  if (eqIndex !== -1 && !/^={1,2}$/.test(clean.slice(eqIndex))) {
    throw new Error("Invalid base64 padding");
  }
  const table = new Array<number>(128).fill(-1);
  for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
  let padding = 0;
  if (clean.endsWith("==")) padding = 2;
  else if (clean.endsWith("=")) padding = 1;
  const out = new Uint8Array(((clean.length / 4) | 0) * 3 - padding);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const a = table[clean.charCodeAt(i)];
    const b = table[clean.charCodeAt(i + 1)];
    const c = clean[i + 2] === "=" ? 0 : table[clean.charCodeAt(i + 2)];
    const d = clean[i + 3] === "=" ? 0 : table[clean.charCodeAt(i + 3)];
    if (a < 0 || b < 0 || c < 0 || d < 0) throw new Error("Invalid base64 character");
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >>> 16) & 0xff;
    if (o < out.length) out[o++] = (n >>> 8) & 0xff;
    if (o < out.length) out[o++] = n & 0xff;
  }
  return out;
}
