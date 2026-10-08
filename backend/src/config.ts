/** Backend configuration — environment only. No secrets are ever logged. */
function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

export interface BackendConfig {
  port: number;
  databaseUrl: string;
  rpcUrl: string;
  programId: string;
  usdcMint: string;
  /** Filesystem path to the verifier keypair JSON (backend-only secret). */
  verifierKeypairPath: string;
  storageDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): BackendConfig {
  return {
    port: Number(env.PORT ?? 4000),
    databaseUrl: required("DATABASE_URL", env.DATABASE_URL),
    rpcUrl: env.RPC_URL ?? "https://api.devnet.solana.com",
    programId:
      env.PROGRAM_ID ?? "EmAPVEMNMa5vmS2GaFSjfNjg1JeWyUhy4fCe3c6PyoMp",
    usdcMint:
      env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    verifierKeypairPath: required(
      "VERIFIER_KEYPAIR_PATH",
      env.VERIFIER_KEYPAIR_PATH
    ),
    storageDir: env.STORAGE_DIR ?? "./.storage",
  };
}
