import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  createMint,
  createAssociatedTokenAccount,
  getAssociatedTokenAddress,
  mintTo,
  getAccount,
  createAccount,
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

const TOKEN_PROGRAM = TOKEN_PROGRAM_ID;
const ASSOCIATED_TOKEN_PROGRAM = ASSOCIATED_TOKEN_PROGRAM_ID;

/** USDC has 6 decimals. $150.00 = 150_000_000 base units. */
export const USDC_DECIMALS = 6;
export const USD_150 = 150_000_000;

describe("proofpay", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  // Typed as `any` until `anchor build` codegens target/types/proofpay.ts,
  // at which point this becomes `Program<Proofpay>`.
  const program: any = anchor.workspace.Proofpay;
  const connection = provider.connection;

  let usdcMint: PublicKey;
  let fakeMint: PublicKey; // wrong-mint negative tests
  let business: Keypair;
  let worker: Keypair;
  let verifier: Keypair;
  let attacker: Keypair;
  let businessAta: PublicKey;

  // Monotonic job ids so every test gets a fresh Job PDA.
  let nextJobId = 1;
  const takeJobId = () => new BN(nextJobId++);

  const jobPda = (businessPk: PublicKey, jobId: BN): [PublicKey, number] =>
    PublicKey.findProgramAddressSync(
      [
        Buffer.from("job"),
        businessPk.toBuffer(),
        jobId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    );

  /** Full happy-path flow for one job; returns PDAs + final balances. */
  async function runHappyPath(jobId: BN, amount: number) {
    const [job] = jobPda(business.publicKey, jobId);
    const escrowAta = await getAssociatedTokenAddress(usdcMint, job, true);
    const workerAta = await getAssociatedTokenAddress(usdcMint, worker.publicKey);
    const sigs: Record<string, string> = {};

    sigs.create = await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(amount))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();

    sigs.fund = await program.methods
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

    sigs.accept = await program.methods
      .acceptJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();

    sigs.submit = await program.methods
      .submitJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();

    sigs.verify = await program.methods
      .verifyJob()
      .accounts({ verifier: verifier.publicKey, job })
      .signers([verifier])
      .rpc();

    sigs.release = await program.methods
      .releasePayment()
      .accounts({
        settlementAuthority: verifier.publicKey,
        job,
        escrowAta,
        workerAta,
        tokenProgram: TOKEN_PROGRAM,
      } as any)
      .signers([verifier])
      .rpc();

    return { job, escrowAta, workerAta, sigs };
  }

  before(async () => {
    business = Keypair.generate();
    worker = Keypair.generate();
    verifier = Keypair.generate();
    attacker = Keypair.generate();

    // Fund SOL for rent + tx fees. On devnet the public faucet is heavily
    // rate-limited, so prefer transfers from the Anchor wallet when it
    // exists (ANCHOR_WALLET); fall back to airdrops (localnet).
    let funder: Keypair | null = null;
    const walletPath = process.env.ANCHOR_WALLET;
    if (walletPath && fs.existsSync(walletPath)) {
      funder = Keypair.fromSecretKey(
        Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf8")))
      );
    }
    const fundSOL = async (to: PublicKey, lamports: number) => {
      if (funder) {
        const sig = await connection.sendTransaction(
          new Transaction().add(
            SystemProgram.transfer({
              fromPubkey: funder.publicKey,
              toPubkey: to,
              lamports,
            })
          ),
          [funder],
          { skipPreflight: false }
        );
        await connection.confirmTransaction(sig, "confirmed");
      } else {
        const sig = await connection.requestAirdrop(to, lamports);
        await connection.confirmTransaction(sig, "confirmed");
      }
    };

    await fundSOL(business.publicKey, 1 * LAMPORTS_PER_SOL);
    for (const kp of [worker, verifier, attacker]) {
      await fundSOL(kp.publicKey, 0.2 * LAMPORTS_PER_SOL);
    }

    // Test USDC mint (6 decimals, like real USDC). On devnet the real
    // Circle mint is 4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU — tests
    // create a local mock with identical decimals so they run anywhere.
    usdcMint = await createMint(
      connection,
      business,
      business.publicKey,
      null,
      USDC_DECIMALS
    );
    fakeMint = await createMint(
      connection,
      business,
      business.publicKey,
      null,
      USDC_DECIMALS
    );

    businessAta = await createAssociatedTokenAccount(
      connection,
      business,
      usdcMint,
      business.publicKey
    );
    // Business starts with $10,000 test USDC.
    await mintTo(
      connection,
      business,
      usdcMint,
      businessAta,
      business.publicKey,
      10_000_000_000
    );
    // Worker ATA exists upfront so balance assertions are trivial.
    await createAssociatedTokenAccount(
      connection,
      business,
      usdcMint,
      worker.publicKey
    );
  });

  // ------------------------------------------------------------------
  // Required coverage
  // ------------------------------------------------------------------

  it("create job", async () => {
    const jobId = takeJobId();
    const [job] = jobPda(business.publicKey, jobId);
    await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(1_000_000))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();

    const acc: any = await program.account.job.fetch(job);
    assert.equal(acc.jobId.toNumber(), jobId.toNumber());
    assert.ok(acc.business.equals(business.publicKey));
    assert.ok(acc.worker.equals(worker.publicKey));
    assert.ok(acc.usdcMint.equals(usdcMint));
    assert.equal(acc.paymentAmount.toNumber(), 1_000_000);
    assert.deepEqual(acc.state, { created: {} });
  });

  it("fund job", async () => {
    const jobId = takeJobId();
    const amount = 2_000_000;
    const [job] = jobPda(business.publicKey, jobId);
    const escrowAta = await getAssociatedTokenAddress(usdcMint, job, true);

    await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(amount))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();

    await program.methods
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

    const acc: any = await program.account.job.fetch(job);
    assert.deepEqual(acc.state, { funded: {} });
    const escrow = await getAccount(connection, escrowAta);
    assert.equal(Number(escrow.amount), amount);
  });

  it("accept job", async () => {
    const jobId = takeJobId();
    const [job] = jobPda(business.publicKey, jobId);
    const escrowAta = await getAssociatedTokenAddress(usdcMint, job, true);
    await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(1_000_000))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();
    await program.methods
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

    await program.methods
      .acceptJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();

    const acc: any = await program.account.job.fetch(job);
    assert.deepEqual(acc.state, { inProgress: {} });
  });

  it("submit valid job", async () => {
    const jobId = takeJobId();
    const [job] = jobPda(business.publicKey, jobId);
    const escrowAta = await getAssociatedTokenAddress(usdcMint, job, true);
    await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(1_000_000))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();
    await program.methods
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
    await program.methods
      .acceptJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();

    await program.methods
      .submitJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();

    const acc: any = await program.account.job.fetch(job);
    assert.deepEqual(acc.state, { submitted: {} });
  });

  it("verify job", async () => {
    const jobId = takeJobId();
    const [job] = jobPda(business.publicKey, jobId);
    const escrowAta = await getAssociatedTokenAddress(usdcMint, job, true);
    await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(1_000_000))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();
    await program.methods
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
    await program.methods
      .acceptJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();
    await program.methods
      .submitJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();

    await program.methods
      .verifyJob()
      .accounts({ verifier: verifier.publicKey, job })
      .signers([verifier])
      .rpc();

    const acc: any = await program.account.job.fetch(job);
    assert.deepEqual(acc.state, { verified: {} });
  });

  it("release payment + worker receives USDC", async () => {
    const jobId = takeJobId();
    const amount = 5_000_000;
    const workerAta = await getAssociatedTokenAddress(usdcMint, worker.publicKey);
    const before = await getAccount(connection, workerAta);

    const { job, escrowAta } = await runHappyPath(jobId, amount);

    const acc: any = await program.account.job.fetch(job);
    assert.deepEqual(acc.state, { settled: {} });
    const after = await getAccount(connection, workerAta);
    assert.equal(Number(after.amount) - Number(before.amount), amount);
    const escrow = await getAccount(connection, escrowAta);
    assert.equal(Number(escrow.amount), 0);
  });

  it("end-to-end: business funds $150 USDC → worker receives $150 USDC", async () => {
    const jobId = takeJobId();
    const workerAta = await getAssociatedTokenAddress(usdcMint, worker.publicKey);
    const before = await getAccount(connection, workerAta);

    const { job, escrowAta, sigs } = await runHappyPath(jobId, USD_150);

    const acc: any = await program.account.job.fetch(job);
    assert.deepEqual(acc.state, { settled: {} });
    assert.equal(acc.paymentAmount.toNumber(), USD_150);
    const after = await getAccount(connection, workerAta);
    assert.equal(Number(after.amount) - Number(before.amount), USD_150);

    console.log("      E2E job PDA:        ", job.toBase58());
    console.log("      E2E escrow ATA:     ", escrowAta.toBase58());
    console.log("      E2E worker:         ", worker.publicKey.toBase58());
    console.log("      E2E worker ATA:     ", workerAta.toBase58());
    console.log("      E2E worker before:  ", Number(before.amount));
    console.log("      E2E worker after:   ", Number(after.amount));
    console.log("      E2E sigs:           ", JSON.stringify(sigs));
  });

  it("invalid premature release fails", async () => {
    const jobId = takeJobId();
    const [job] = jobPda(business.publicKey, jobId);
    const escrowAta = await getAssociatedTokenAddress(usdcMint, job, true);
    const workerAta = await getAssociatedTokenAddress(usdcMint, worker.publicKey);
    // Funded but never submitted/verified.
    await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(1_000_000))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();
    await program.methods
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

    let failed = false;
    try {
      await program.methods
        .releasePayment()
        .accounts({
          settlementAuthority: verifier.publicKey,
          job,
          escrowAta,
          workerAta,
          tokenProgram: TOKEN_PROGRAM,
        } as any)
        .signers([verifier])
        .rpc();
    } catch {
      failed = true;
    }
    assert.ok(failed, "release before VERIFIED must fail");
  });

  it("invalid worker cannot accept", async () => {
    const jobId = takeJobId();
    const [job] = jobPda(business.publicKey, jobId);
    const escrowAta = await getAssociatedTokenAddress(usdcMint, job, true);
    await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(1_000_000))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();
    await program.methods
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

    let failed = false;
    try {
      await program.methods
        .acceptJob()
        .accounts({ worker: attacker.publicKey, job })
        .signers([attacker])
        .rpc();
    } catch {
      failed = true;
    }
    assert.ok(failed, "non-assigned worker must not accept");
  });

  it("invalid verifier cannot verify", async () => {
    const jobId = takeJobId();
    const [job] = jobPda(business.publicKey, jobId);
    const escrowAta = await getAssociatedTokenAddress(usdcMint, job, true);
    await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(1_000_000))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();
    await program.methods
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
    await program.methods
      .acceptJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();
    await program.methods
      .submitJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();

    let failed = false;
    try {
      await program.methods
        .verifyJob()
        .accounts({ verifier: attacker.publicKey, job })
        .signers([attacker])
        .rpc();
    } catch {
      failed = true;
    }
    assert.ok(failed, "non-assigned verifier must not verify");
  });

  it("rejected submission", async () => {
    const jobId = takeJobId();
    const [job] = jobPda(business.publicKey, jobId);
    const escrowAta = await getAssociatedTokenAddress(usdcMint, job, true);
    await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(1_000_000))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();
    await program.methods
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
    await program.methods
      .acceptJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();
    await program.methods
      .submitJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();

    await program.methods
      .rejectJob()
      .accounts({ verifier: verifier.publicKey, job })
      .signers([verifier])
      .rpc();

    const acc: any = await program.account.job.fetch(job);
    assert.deepEqual(acc.state, { rejected: {} });
  });

  it("resubmission", async () => {
    const jobId = takeJobId();
    const [job] = jobPda(business.publicKey, jobId);
    const escrowAta = await getAssociatedTokenAddress(usdcMint, job, true);
    await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(1_000_000))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();
    await program.methods
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
    await program.methods
      .acceptJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();
    await program.methods
      .submitJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();
    await program.methods
      .rejectJob()
      .accounts({ verifier: verifier.publicKey, job })
      .signers([verifier])
      .rpc();

    // REJECTED → IN_PROGRESS → SUBMITTED → VERIFIED works.
    await program.methods
      .resubmitJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();
    let acc: any = await program.account.job.fetch(job);
    assert.deepEqual(acc.state, { inProgress: {} });

    await program.methods
      .submitJob()
      .accounts({ worker: worker.publicKey, job })
      .signers([worker])
      .rpc();
    acc = await program.account.job.fetch(job);
    assert.deepEqual(acc.state, { submitted: {} });
  });

  it("double settlement fails", async () => {
    const jobId = takeJobId();
    const { job, escrowAta, workerAta } = await runHappyPath(jobId, 1_000_000);

    let failed = false;
    try {
      await program.methods
        .releasePayment()
        .accounts({
          settlementAuthority: verifier.publicKey,
          job,
          escrowAta,
          workerAta,
          tokenProgram: TOKEN_PROGRAM,
        } as any)
        .signers([verifier])
        .rpc();
    } catch {
      failed = true;
    }
    assert.ok(failed, "second release must fail");
  });

  it("incorrect USDC mint fails", async () => {
    const jobId = takeJobId();
    const [job] = jobPda(business.publicKey, jobId);
    await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(1_000_000))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();

    // Attacker business ATA on the *wrong* mint + wrong escrow derivation.
    const wrongBusinessAta = await createAccount(
      connection,
      business,
      fakeMint,
      business.publicKey
    );
    const wrongEscrowAta = await getAssociatedTokenAddress(fakeMint, job, true);

    let failed = false;
    try {
      await program.methods
        .fundJob()
        .accounts({
          business: business.publicKey,
          job,
          usdcMint: fakeMint,
          businessAta: wrongBusinessAta,
          escrowAta: wrongEscrowAta,
          tokenProgram: TOKEN_PROGRAM,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM,
          systemProgram: SystemProgram.programId,
        } as any)
        .signers([business])
        .rpc();
    } catch {
      failed = true;
    }
    assert.ok(failed, "funding with the wrong mint must fail");
  });

  it("unauthorized state transitions fail", async () => {
    const jobId = takeJobId();
    const [job] = jobPda(business.publicKey, jobId);
    await program.methods
      .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(1_000_000))
      .accounts({
        business: business.publicKey,
        job,
        usdcMint,
        systemProgram: SystemProgram.programId,
      })
      .signers([business])
      .rpc();

    // Cannot submit before accept; cannot verify before submit;
    // attacker cannot release; worker cannot verify.
    const badCalls: Promise<any>[] = [
      program.methods
        .submitJob()
        .accounts({ worker: worker.publicKey, job })
        .signers([worker])
        .rpc(),
      program.methods
        .verifyJob()
        .accounts({ verifier: verifier.publicKey, job })
        .signers([verifier])
        .rpc(),
      program.methods
        .acceptJob()
        .accounts({ worker: worker.publicKey, job })
        .signers([worker])
        .rpc(), // CREATED, not FUNDED
    ];
    for (const call of badCalls) {
      let failed = false;
      try {
        await call;
      } catch {
        failed = true;
      }
      assert.ok(failed, "out-of-order transition must fail");
    }
  });
});
