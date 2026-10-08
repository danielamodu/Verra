/**
 * Verification ↔ on-chain integration (requires devnet + ANCHOR_WALLET):
 *
 *   JOB FUNDED → WORKER ACCEPTS → WORKER SUBMITS (on-chain) →
 *   WORKER SUBMITS VALID EVIDENCE (off-chain service) →
 *   ENGINE RETURNS VERIFIED → AUTHORIZED VERIFIER CALLS verify_job →
 *   ON-CHAIN STATE = VERIFIED
 *
 * Payment is intentionally NOT released here; settlement compatibility is
 * already proven by the Phase 1 suite.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { assert } from "chai";
import fs from "fs";
import {
  VerificationService,
  deriveJobPda,
  verifyJobOnChain,
  storeInspectionRequirements,
  validStoreSubmission,
} from "../verification";

const TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID;

const USD_150 = 150_000_000;

describe("verification → verify_job (devnet)", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program: any = anchor.workspace.Proofpay;
  const connection = provider.connection;

  let usdcMint: PublicKey;
  let business: Keypair;
  let worker: Keypair;
  let verifier: Keypair;
  let businessAta: PublicKey;

  async function fundSOL(to: PublicKey, lamports: number) {
    const walletPath = process.env.ANCHOR_WALLET;
    if (walletPath && fs.existsSync(walletPath)) {
      const funder = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
      );
      const sig = await connection.sendTransaction(
        new Transaction().add(
          SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: to, lamports })
        ),
        [funder],
        { skipPreflight: false }
      );
      await connection.confirmTransaction(sig, "confirmed");
    } else {
      const sig = await connection.requestAirdrop(to, lamports);
      await connection.confirmTransaction(sig, "confirmed");
    }
  }

  before(async () => {
    business = Keypair.generate();
    worker = Keypair.generate();
    verifier = Keypair.generate();

    // Rent payers only: the provider wallet covers tx fees; business pays
    // account creation (~0.01 SOL total). Kept small for faucet-scarce devnet.
    await fundSOL(business.publicKey, 0.1 * LAMPORTS_PER_SOL);
    await fundSOL(worker.publicKey, 0.005 * LAMPORTS_PER_SOL);
    await fundSOL(verifier.publicKey, 0.005 * LAMPORTS_PER_SOL);

    usdcMint = await createMint(connection, business, business.publicKey, null, 6);
    businessAta = await createAssociatedTokenAccount(
      connection,
      business,
      usdcMint,
      business.publicKey
    );
    await mintTo(connection, business, usdcMint, businessAta, business.publicKey, 10_000_000_000);
  });

  it("funded → accepted → valid evidence → VERIFIED → verify_job → on-chain VERIFIED", async () => {
    const jobId = new BN(9001);
    const [job] = deriveJobPda(program.programId, business.publicKey, jobId);
    const escrowAta = await getAssociatedTokenAddress(usdcMint, job, true);

    const sigCreate = await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(USD_150))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();

    const sigFund = await program.methods
      .fundJob()
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        businessAta,
        escrowAta,
        tokenProgram: TOKEN_PROGRAM,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
        systemProgram: SystemProgram.programId,
      } as any)
      .signers([business])
      .rpc();

    const sigAccept = await program.methods
      .acceptJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();

    const sigSubmit = await program.methods
      .submitJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();

    // Off-chain: worker submits evidence to the verification service.
    const svc = new VerificationService({
      jobId: jobId.toString(),
      worker: worker.publicKey.toBase58(),
      verifier: verifier.publicKey.toBase58(),
      requirements: storeInspectionRequirements(),
    });
    const submission = validStoreSubmission({
      jobId: jobId.toString(),
      worker: worker.publicKey.toBase58(),
      submissionId: "int-sub-1",
      submittedAt: new Date().toISOString(),
    });
    const result = svc.submit(submission);
    assert.equal(result.status, "VERIFIED");
    assert.isTrue(result.checks.every((c) => c.passed));

    // Server-side authorization → verifier-signed verify_job.
    const ticket = svc.authorizeOnChainVerify(result);
    const sigVerify = await verifyJobOnChain(program, ticket, job, verifier);

    const acc: any = await program.account.job.fetch(job);
    assert.deepEqual(acc.state, { verified: {} });

    console.log("      INT job PDA:      ", job.toBase58());
    console.log("      INT engine:       ", `${result.status} (${result.reason})`);
    console.log("      INT sigs:         ", JSON.stringify({ sigCreate, sigFund, sigAccept, sigSubmit, sigVerify }));
  });
});
