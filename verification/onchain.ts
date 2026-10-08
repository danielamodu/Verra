/**
 * On-chain boundary: turn a server-side authorization ticket into the
 * `verify_job` transaction signed by the verifier keypair.
 *
 * What is enforced where:
 *   - Off-chain (engine/service): what counts as valid evidence, whether the
 *     checklist is complete, identity binding (job/worker), hash integrity.
 *   - On-chain (proofpay program): state machine (SUBMITTED → VERIFIED),
 *     signer === recorded verifier, escrow custody, single settlement.
 *
 * The verifier Keypair lives here, on the backend/operator side. It is never
 * sent to, or signable by, the worker client.
 */
import { BN } from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import type { VerifyAuthorization } from "./schema";

/** Minimal surface the on-chain helper needs (avoids importing program types). */
export interface VerifyJobCaller {
  methods: {
    verifyJob(): {
      accounts(ctx: { verifier: PublicKey; job: PublicKey }): {
        signers(s: unknown[]): { rpc(): Promise<string> };
      };
    };
  };
}

export function deriveJobPda(
  programId: PublicKey,
  business: PublicKey,
  jobId: BN
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("job"), business.toBuffer(), jobId.toArrayLike(Buffer, "le", 8)],
    programId
  );
}

/**
 * Execute `verify_job` for an authorized ticket. The ticket must have been
 * produced by VerificationService.authorizeOnChainVerify (VERIFIED only);
 * this function additionally requires the live verifier Keypair object, so
 * a stolen/leaked ticket alone still cannot verify without the key.
 */
export async function verifyJobOnChain(
  program: VerifyJobCaller,
  ticket: VerifyAuthorization,
  jobPda: PublicKey,
  verifierKeypair: { publicKey: PublicKey }
): Promise<string> {
  if (ticket.verifier !== verifierKeypair.publicKey.toBase58()) {
    throw new Error("verifier keypair does not match the authorization ticket");
  }
  return program.methods
    .verifyJob()
    .accounts({ verifier: verifierKeypair.publicKey, job: jobPda })
    .signers([verifierKeypair])
    .rpc();
}

/** Minimal surface for the settlement step (operator/backend side only). */
export interface ReleasePaymentCaller {
  methods: {
    releasePayment(): {
      accounts(ctx: {
        settlementAuthority: PublicKey;
        job: PublicKey;
        escrowAta: PublicKey;
        workerAta: PublicKey;
        tokenProgram: PublicKey;
      }): {
        signers(s: unknown[]): { rpc(): Promise<string> };
      };
    };
  };
}

export interface SettlementAccounts {
  job: PublicKey;
  escrowAta: PublicKey;
  workerAta: PublicKey;
  tokenProgram: PublicKey;
}

/**
 * Operator helper: verify a VERIFIED job then release escrow to the worker.
 * Runs where the verifier keypair lives (backend/operator machine — NEVER
 * the phone). Returns both confirmed signatures for the Verra Receipt.
 */
export async function verifyAndSettle(
  program: VerifyJobCaller & ReleasePaymentCaller,
  ticket: VerifyAuthorization,
  accounts: SettlementAccounts,
  verifierKeypair: { publicKey: PublicKey }
): Promise<{ verifySignature: string; releaseSignature: string }> {
  const verifySignature = await verifyJobOnChain(
    program,
    ticket,
    accounts.job,
    verifierKeypair
  );
  if (ticket.verifier !== verifierKeypair.publicKey.toBase58()) {
    throw new Error("verifier keypair does not match the authorization ticket");
  }
  const releaseSignature = await program.methods
    .releasePayment()
    .accounts({
      settlementAuthority: verifierKeypair.publicKey,
      job: accounts.job,
      escrowAta: accounts.escrowAta,
      workerAta: accounts.workerAta,
      tokenProgram: accounts.tokenProgram,
    })
    .signers([verifierKeypair])
    .rpc();
  return { verifySignature, releaseSignature };
}
