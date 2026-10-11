import { loadConfig } from "./config";
import { logger } from "./logger";
import { getPrisma } from "./infrastructure/db/client";
import { getSolana, getBondGate } from "./infrastructure/solana/context";
import { EvidenceStore } from "./infrastructure/storage/evidenceStore";
import { createApp } from "./api/app";

const config = loadConfig();
const db = getPrisma();
const solana = getSolana(config.rpcUrl, config.programId, config.verifierKeypairPath);

// Activate SKR bond-gating only when fully configured; otherwise the
// settlement path runs the untouched USDC baseline. See docs/skr-bond.md.
if (config.bondProgramId && config.skrMint && config.minBond) {
  solana.bond = getBondGate(
    solana.connection,
    config.bondProgramId,
    config.skrMint,
    BigInt(config.minBond)
  );
  logger.info("SKR bond-gating active", {
    bondProgramId: config.bondProgramId,
    minBond: config.minBond,
  });
}

const store = new EvidenceStore(config.storageDir);

const app = createApp({ db, solana, store, config });

app.listen(config.port, () => {
  logger.info("backend listening", { port: config.port, rpcUrl: config.rpcUrl });
});
