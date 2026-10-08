/**
 * Fails if the mobile app bundles anything that looks like a private key,
 * mnemonic, or keypair file. Run: npm run secrets-check (mobile/).
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const SKIP_DIRS = new Set(["node_modules", "android", "dist", ".expo"]);
const SKIP_FILES = new Set(["check-no-secrets.js"]);

const CODE_PATTERNS = [
  /fromSecretKey/,
  /\bsecretKey\s*[:=]/,
  /\bprivateKey\s*[:=]/,
  /\bmnemonic\s*[:=]/,
  /Keypair\.generate/,
  /new\s+Keypair\s*\(/,
  /\[\s*\d{1,3}(,\s*\d{1,3}){31,}\]/, // Solana secret-key byte arrays
];
const KEYPAIR_FILE = /keypair.*\.json$/i;

let failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(full);
      continue;
    }
    if (SKIP_FILES.has(entry.name)) continue;
    const rel = path.relative(ROOT, full);
    if (KEYPAIR_FILE.test(entry.name)) {
      failures.push(`${rel}: keypair file must never ship in the app`);
      continue;
    }
    if (!/\.(ts|tsx|js|jsx|json)$/.test(entry.name)) continue;
    const text = fs.readFileSync(full, "utf8");
    for (const re of CODE_PATTERNS) {
      if (re.test(text)) failures.push(`${rel}: matches ${re}`);
    }
  }
}

walk(ROOT);
if (failures.length > 0) {
  console.error("SECRET SCAN FAILED:\n" + failures.join("\n"));
  process.exit(1);
}
console.log("secret scan clean: no private keys, mnemonics, or keypair files in mobile/");
