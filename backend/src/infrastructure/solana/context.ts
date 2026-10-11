/**
 * Solana infrastructure: connection, program, verifier key, reconciliation.
 * The verifier keypair is loaded from VERIFIER_KEYPAIR_PATH into memory only.
 * It is never logged, returned, or persisted.
 */
import * as fs from "node:fs";
import { AnchorProvider, BN, BorshAccountsCoder, Program, Wallet } from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import idl from "../../../../idl/proofpay.json";
import bondIdl from "../../../../idl/verra_bond.json";
import { deriveJobPda } from "../../../../verification/onchain";

/**
 * Verifier-bond read gate (verra_bond program). Present only when the backend
 * is configured for bond-gating; absent, settlement behaves as the untouched
 * baseline. See docs/skr-bond.md.
 */
export interface BondStatus {
  exists: boolean;
  active: boolean;
  amount: bigint;
}
export interface BondGate {
  minBond: bigint;
  skrMint: string;
  readBond(verifier: string): Promise<BondStatus>;
}

export interface SolanaContext {
  connection: Connection;
  program: any;
  programId: PublicKey;
  verifierKeypair: Keypair;
  /** Optional SKR bond gate; when set, settlement fails closed on an unbonded verifier. */
  bond?: BondGate;
}

let cached: SolanaContext | null = null;

export function getSolana(
  rpcUrl: string,
  programIdStr: string,
  verifierKeypairPath: string
): SolanaContext {
  if (cached) return cached;
  const connection = new Connection(rpcUrl, "confirmed");
  const programId = new PublicKey(programIdStr);
  const secret = Uint8Array.from(
    JSON.parse(fs.readFileSync(verifierKeypairPath, "utf8"))
  );
  const verifierKeypair = Keypair.fromSecretKey(secret);
  // Backend-held verifier wallet: signs verify/release server-side.
  // This is the ONLY key the backend ever holds (never user keys).
  const provider = new AnchorProvider(
    connection,
    new Wallet(verifierKeypair),
    { commitment: "confirmed" }
  );
  const program = new Program(idl as any, provider);
  cached = { connection, program, programId, verifierKeypair };
  return cached;
}

/** Test helper: reset the cached context (fresh keys per test run). */
export function resetSolana(): void {
  cached = null;
}

export async function confirmSignature(
  connection: Connection,
  signature: string
): Promise<void> {
  const latest = await connection.getLatestBlockhash("confirmed");
  const res = await connection.confirmTransaction(
    { signature, ...latest },
    "confirmed"
  );
  if (res.value.err) throw new Error(`Transaction failed: ${signature}`);
}

export interface ChainJobView {
  exists: boolean;
  state?: "CREATED" | "FUNDED" | "IN_PROGRESS" | "SUBMITTED" | "VERIFIED" | "REJECTED" | "SETTLED";
  paymentAmount?: number;
  worker?: string;
  business?: string;
  usdcMint?: string;
}

const STATE_MAP: Record<string, NonNullable<ChainJobView["state"]>> = {
  Created: "CREATED",
  Funded: "FUNDED",
  InProgress: "IN_PROGRESS",
  Submitted: "SUBMITTED",
  Verified: "VERIFIED",
  Rejected: "REJECTED",
  Settled: "SETTLED",
};

/** Read + decode the on-chain Job account (anchor client casing). */
export async function readChainJob(
  program: any,
  jobPda: PublicKey
): Promise<ChainJobView> {
  try {
    const acc: any = await program.account.job.fetch(jobPda);
    // Normalize casing: direct coder.decode yields IDL names ("Verified")
    // while program.account.fetch yields camelCase ("verified").
    const raw: string | undefined = acc.state ? Object.keys(acc.state)[0] : undefined;
    const name = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : undefined;
    const state = name ? STATE_MAP[name] : undefined;
    return {
      exists: true,
      state,
      paymentAmount:
        typeof acc.paymentAmount?.toNumber === "function"
          ? acc.paymentAmount.toNumber()
          : Number(acc.paymentAmount),
      worker: acc.worker?.toBase58?.() ?? String(acc.worker),
      business: acc.business?.toBase58?.() ?? String(acc.business),
      usdcMint: acc.usdcMint?.toBase58?.() ?? String(acc.usdcMint),
    };
  } catch {
    return { exists: false };
  }
}

export function jobPdaFor(
  programId: PublicKey,
  business: PublicKey,
  jobId: string
): PublicKey {
  return deriveJobPda(programId, business, new BN(jobId))[0];
}

export async function escrowAtaFor(
  usdcMint: PublicKey,
  jobPda: PublicKey
): Promise<PublicKey> {
  return getAssociatedTokenAddress(usdcMint, jobPda, true);
}

export async function tokenBalance(
  connection: Connection,
  ata: PublicKey
): Promise<number> {
  try {
    const res = await connection.getTokenAccountBalance(ata, "confirmed");
    return Number(res.value.amount);
  } catch {
    return 0;
  }
}

export { TOKEN_PROGRAM_ID };

const bondCoder = new BorshAccountsCoder(bondIdl as any);

/** Derive the VerifierBond PDA for a verifier under the verra_bond program. */
export function verifierBondPda(
  bondProgramId: PublicKey,
  verifier: PublicKey
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("bond"), verifier.toBuffer()],
    bondProgramId
  )[0];
}

/**
 * Build a bond gate backed by live RPC reads of the verra_bond program.
 * `readBond` fails closed: a decode error or missing account reports an
 * inactive bond (never silently "authorized").
 */
export function getBondGate(
  connection: Connection,
  bondProgramIdStr: string,
  skrMint: string,
  minBond: bigint
): BondGate {
  const bondProgramId = new PublicKey(bondProgramIdStr);
  return {
    minBond,
    skrMint,
    async readBond(verifier: string): Promise<BondStatus> {
      const pda = verifierBondPda(bondProgramId, new PublicKey(verifier));
      const info = await connection.getAccountInfo(pda, "confirmed");
      if (!info) return { exists: false, active: false, amount: 0n };
      const acc: any = bondCoder.decode("VerifierBond", info.data);
      // Normalize enum casing: coder.decode yields IDL names ("Active"),
      // program.account.fetch yields camelCase ("active"). Compare lower-cased.
      const stateKey = acc?.state ? Object.keys(acc.state)[0] : undefined;
      const amount = BigInt(acc?.amount?.toString?.() ?? "0");
      return { exists: true, active: String(stateKey).toLowerCase() === "active", amount };
    },
  };
}
