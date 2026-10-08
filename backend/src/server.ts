import { loadConfig } from "./config";
import { logger } from "./logger";
import { getPrisma } from "./infrastructure/db/client";
import { getSolana } from "./infrastructure/solana/context";
import { EvidenceStore } from "./infrastructure/storage/evidenceStore";
import { createApp } from "./api/app";

const config = loadConfig();
const db = getPrisma();
const solana = getSolana(config.rpcUrl, config.programId, config.verifierKeypairPath);
const store = new EvidenceStore(config.storageDir);

const app = createApp({ db, solana, store, config });

app.listen(config.port, () => {
  logger.info("backend listening", { port: config.port, rpcUrl: config.rpcUrl });
});
