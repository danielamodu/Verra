/**
 * Evidence byte storage: content-addressed files (name = sha256 hex).
 * Stores raw bytes ONLY when the client uploads them (optional
 * `contentBase64`); the declared contentHash is always re-verified.
 * Filenames are hashes — no metadata leaks onto disk.
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

export function sha256HexBytes(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class EvidenceStore {
  constructor(private readonly dir: string) {
    fs.mkdirSync(dir, { recursive: true });
  }

  /** Store bytes; throws unless they hash to `expectedHash`. Returns the path. */
  put(expectedHash: string, contentBase64: string): string {
    const bytes = Buffer.from(contentBase64, "base64");
    const actual = sha256HexBytes(bytes);
    if (actual !== expectedHash.toLowerCase()) {
      throw new Error("Uploaded bytes do not match declared contentHash.");
    }
    const file = path.join(this.dir, actual);
    if (!fs.existsSync(file)) fs.writeFileSync(file, bytes);
    return file;
  }

  get(contentHash: string): Buffer | null {
    const file = path.join(this.dir, contentHash.toLowerCase());
    return fs.existsSync(file) ? fs.readFileSync(file) : null;
  }
}
