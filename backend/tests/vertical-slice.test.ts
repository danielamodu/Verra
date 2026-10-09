/**
 * REAL vertical slice (no mocked success path):
 *
 *   chain create+fund → API register → chain accept → API accept →
 *   chain submit → API submit (signed) → API verify (engine) →
 *   API settle (verify_job + release_payment) → receipt.
 *
 * Plus the failure path: incomplete work → REJECTED → escrow stays locked.
 *
 * Runs against localnet by default (CHAIN_URL) and devnet when funded.
 * Gate: RUN_CHAIN_SLICE=1 (set by npm run test:slice).
 */
import { assert } from "chai";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { BN } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createMint,
  getAssociatedTokenAddress,
  getAccount,
  mintTo,
} from "@solana/spl-token";
import { getPrisma } from "../src/infrastructure/db/client";
import {
  getSolana,
  resetSolana,
  tokenBalance,
} from "../src/infrastructure/solana/context";
import { request, testApp, wipe, closePrisma, REQS } from "./helpers";

const CHAIN_URL = process.env.CHAIN_URL ?? "http://127.0.0.1:8899";
const PROGRAM_ID = process.env.PROGRAM_ID ?? "EmAPVEMNMa5vmS2GaFSjfNjg1JeWyUhy4fCe3c6PyoMp";
const USD_150 = 150_000_000;
const RUN_SLICE = process.env.RUN_CHAIN_SLICE === "1";

async function airdrop(connection: any, to: PublicKey, sol: number) {
  const sig = await connection.requestAirdrop(to, sol * 1_000_000_000);
  await connection.confirmTransaction(sig, "confirmed");
}

(RUN_SLICE ? describe : describe.skip)("vertical slice (real chain)", () => {
  const db = getPrisma();
  let app: ReturnType<typeof testApp>;
  let solana: ReturnType<typeof getSolana>;
  let business: Keypair;
  let worker: Keypair;
  let usdcMint: PublicKey;
  let businessAta: PublicKey;
  let nonce = 0;

  function loadKeypair(keyfile: string | undefined): Keypair | null {
    if (!keyfile) return null;
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keyfile, "utf8"))));
  }

  before(async function () {
    this.timeout(300000);
    await wipe(db);
    resetSolana();

    // Fixed operator wallets (devnet) via env keypair files, else ephemeral.
    business = loadKeypair(process.env.SLICE_BUSINESS_KEYPAIR) ?? Keypair.generate();
    worker = loadKeypair(process.env.SLICE_WORKER_KEYPAIR) ?? Keypair.generate();
    const fixedVerifier = loadKeypair(process.env.SLICE_VERIFIER_KEYPAIR);
    const verifier = fixedVerifier ?? Keypair.generate();
    const keyfile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "verra-op-")), "verifier.json");
    fs.writeFileSync(keyfile, JSON.stringify(Array.from(verifier.secretKey)));

    solana = getSolana(CHAIN_URL, PROGRAM_ID, keyfile);
    (solana as any).sliceVerifier = verifier;
    app = testApp(solana);

    if (process.env.SLICE_BUSINESS_KEYPAIR && process.env.SLICE_WORKER_KEYPAIR) {
      // Pre-funded fixed wallets — no faucet needed.
      const [bb, wb, vb] = await Promise.all(
        [business, worker, verifier].map((k) => solana.connection.getBalance(k.publicKey))
      );
      console.log(`      operator balances: business=${bb} worker=${wb} verifier=${vb} lamports`);
    } else {
      await airdrop(solana.connection, business.publicKey, 3);
      await airdrop(solana.connection, worker.publicKey, 1);
      // The backend verifier pays for verify_job + release_payment on-chain.
      await airdrop(solana.connection, verifier.publicKey, 2);
    }

    usdcMint = await createMint(solana.connection, business, business.publicKey, null, 6);
    businessAta = await createAssociatedTokenAccount(
      solana.connection, business, usdcMint, business.publicKey
    );
    await mintTo(solana.connection, business, usdcMint, businessAta, business.publicKey, 10_000_000_000);
  });

  after(async () => closePrisma());

  async function sendAs(builder: any, payer: Keypair): Promise<string> {
    const tx = await builder.transaction();
    const latest = await solana.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = latest.blockhash;
    tx.feePayer = payer.publicKey;
    tx.sign(payer);
    const sig = await solana.connection.sendRawTransaction(tx.serialize());
    await solana.connection.confirmTransaction(
      { signature: sig, blockhash: latest.blockhash, lastValidBlockHeight: latest.lastValidBlockHeight },
      "confirmed"
    );
    return sig;
  }

  async function beginOnChainJob(tag: string, amount: number) {
    void tag;
    nonce += 1;
    // Unique across reruns even with a fixed business wallet.
    const jobId = new BN(
      `${Date.now() % 1000000}${String(nonce).padStart(3, "0")}${Math.floor(Math.random() * 1000)}`
    );
    const program: any = solana.program;
    const verifier: Keypair = (solana as any).sliceVerifier;
    const [jobPda] = PublicKey.findProgramAddressSync(
      [Buffer.from("job"), business.publicKey.toBuffer(), jobId.toArrayLike(Buffer, "le", 8)],
      new PublicKey(PROGRAM_ID)
    );
    const escrowAta = await getAssociatedTokenAddress(usdcMint, jobPda, true);
    const sigCreate: string = await sendAs(
      program.methods
        .createJob(jobId, worker.publicKey, verifier.publicKey, new BN(amount))
        .accounts({
          business: business.publicKey,
          job: jobPda,
          usdcMint,
          systemProgram: SystemProgram.programId,
        }),
      business
    );
    const sigFund: string = await sendAs(
      program.methods
        .fundJob()
        .accounts({
          business: business.publicKey,
          job: jobPda,
          usdcMint,
          businessAta,
          escrowAta,
          tokenProgram: TOKEN_PROGRAM_ID,
          associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        }),
      business
    );
    return { jobId: jobId.toString(), jobPda, escrowAta, sigCreate, sigFund, verifier };
  }

  async function onChainAccept(jobPda: PublicKey): Promise<string> {
    const program: any = solana.program;
    return sendAs(
      program.methods.acceptJob().accounts({ worker: worker.publicKey, job: jobPda }),
      worker
    );
  }

  async function onChainSubmit(jobPda: PublicKey): Promise<string> {
    const program: any = solana.program;
    return sendAs(
      program.methods.submitJob().accounts({ worker: worker.publicKey, job: jobPda }),
      worker
    );
  }

  it("failure path: incomplete work stays locked, nothing settles", async function () {
    this.timeout(300000);
    const j = await beginOnChainJob("fail", USD_150);
    const reg = await request(app).post("/api/jobs").send({
      jobId: j.jobId,
      jobPda: j.jobPda.toBase58(),
      business: business.publicKey.toBase58(),
      worker: worker.publicKey.toBase58(),
      verifier: j.verifier.publicKey.toBase58(),
      title: "Inspect 10 stores",
      paymentAmount: USD_150,
      usdcMint: usdcMint.toBase58(),
      requirements: REQS,
      chain: { createTx: j.sigCreate, fundTx: j.sigFund },
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.equal(reg.body.state, "FUNDED");

    const sigAccept = await onChainAccept(j.jobPda);
    const acc = await request(app).post(`/api/jobs/${reg.body.id}/accept`).send({
      worker: worker.publicKey.toBase58(),
      acceptTx: sigAccept,
    });
    assert.equal(acc.status, 200, JSON.stringify(acc.body));

    await onChainSubmit(j.jobPda);

    const badChecklist = [{ requirement_id: "visit-checklist", completed: false }];
    const sub = await request(app).post("/api/submissions").send({
      jobId: j.jobId,
      worker: worker.publicKey.toBase58(),
      submissionId: `slice-fail-${j.jobId}`,
      checklistResults: badChecklist,
      evidence: [],
      submittedAt: new Date().toISOString(),
    });
    assert.equal(sub.status, 201, JSON.stringify(sub.body).slice(0, 300));

    const ver = await request(app).post(`/api/verification/slice-fail-${j.jobId}`).send();
    assert.equal(ver.body.result.status, "REJECTED");
    assert.isNull(ver.body.attestationId);

    const noReceipt = await request(app).get(`/api/settlements/${j.jobId}`);
    assert.equal(noReceipt.status, 404);

    const settle = await request(app).post("/api/settle").send({ jobId: j.jobId });
    assert.notEqual(settle.status, 200);
    assert.equal(await db.settlement.count(), 0);

    const escrow = await getAccount(solana.connection, j.escrowAta);
    assert.equal(Number(escrow.amount), USD_150, "escrow must remain locked");

    const events = await request(app).get(`/api/jobs/${reg.body.id}/activity`);
    const types = events.body.map((e: any) => e.type);
    assert.include(types, "REJECTED");
    assert.notInclude(types, "PAYMENT_RELEASED");
  });

  it("happy path: verify → settle → worker +$150 USDC → receipt", async function () {
    this.timeout(600000);
    const j = await beginOnChainJob("happy", USD_150);
    const reg = await request(app).post("/api/jobs").send({
      jobId: j.jobId,
      jobPda: j.jobPda.toBase58(),
      business: business.publicKey.toBase58(),
      worker: worker.publicKey.toBase58(),
      verifier: j.verifier.publicKey.toBase58(),
      title: "Inspect 10 stores",
      paymentAmount: USD_150,
      usdcMint: usdcMint.toBase58(),
      requirements: REQS,
      chain: { createTx: j.sigCreate, fundTx: j.sigFund },
    });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    const sigAccept = await onChainAccept(j.jobPda);
    assert.equal(
      (await request(app).post(`/api/jobs/${reg.body.id}/accept`).send({
        worker: worker.publicKey.toBase58(),
        acceptTx: sigAccept,
      })).status,
      200
    );

    const sigSubmit: string = await onChainSubmit(j.jobPda);

    const workerAta = await createAssociatedTokenAccount(
      solana.connection, business, usdcMint, worker.publicKey
    );
    const workerBefore = await tokenBalance(solana.connection, workerAta);

    const submittedAt = new Date().toISOString();
    const evidence = Array.from({ length: 10 }, (_, i) => {
      const bytes = Buffer.from(`slice-photo-${j.jobId}-${i}`);
      return {
        requirementId: "store-photos",
        type: "PHOTO_EVIDENCE",
        storageRef: `slice://${j.jobId}/${i}.jpg`,
        contentHash: createHash("sha256").update(bytes).digest("hex"),
        capturedAt: submittedAt,
        metadata: {},
      };
    });
    const checklist = [{ requirement_id: "visit-checklist", completed: true }];
    const subId = `slice-ok-${j.jobId}`;
    const sub = await request(app).post("/api/submissions").send({
      jobId: j.jobId,
      worker: worker.publicKey.toBase58(),
      submissionId: subId,
      checklistResults: checklist,
      evidence,
      submittedAt,
    });
    assert.equal(sub.status, 201, JSON.stringify(sub.body).slice(0, 300));

    const ver = await request(app).post(`/api/verification/${subId}`).send();
    assert.equal(ver.body.result.status, "VERIFIED");
    assert.isString(ver.body.attestationId);

    const settle = await request(app).post("/api/settle").send({ jobId: j.jobId });
    assert.equal(settle.status, 200, JSON.stringify(settle.body).slice(0, 300));
    assert.equal(settle.body.status, "CONFIRMED");
    assert.isString(settle.body.verifyTx);
    assert.isString(settle.body.releaseTx);

    const workerAfter = await tokenBalance(solana.connection, workerAta);
    assert.equal(workerAfter - workerBefore, USD_150);
    const escrow = await getAccount(solana.connection, j.escrowAta);
    assert.equal(Number(escrow.amount), 0);

    const events = await request(app).get(`/api/jobs/${reg.body.id}/activity`);
    const types = events.body.map((e: any) => e.type);
    for (const t of ["JOB_CREATED", "FUNDED", "ACCEPTED", "SUBMITTED", "VERIFICATION_STARTED", "VERIFIED", "SETTLEMENT_STARTED", "PAYMENT_RELEASED"]) {
      assert.include(types, t);
    }

    const attestation = await db.verificationAttestation.findFirst({
      where: { submissionId: subId },
    });

    const artifact = {
      cluster: CHAIN_URL,
      programId: PROGRAM_ID,
      jobPda: j.jobPda.toBase58(),
      escrowAta: j.escrowAta.toBase58(),
      business: business.publicKey.toBase58(),
      worker: worker.publicKey.toBase58(),
      verifier: j.verifier.publicKey.toBase58(),
      usdcMint: usdcMint.toBase58(),
      submissionId: subId,
      attestationId: ver.body.attestationId,
      attestationDigest: attestation?.canonicalDigest,
      sigCreate: j.sigCreate,
      sigFund: j.sigFund,
      sigAccept,
      sigSubmit,
      verifyTx: settle.body.verifyTx,
      releaseTx: settle.body.releaseTx,
      workerBalanceBefore: workerBefore,
      workerBalanceAfter: workerAfter,
    };
    const dir = path.join(__dirname, "artifacts");
    fs.mkdirSync(dir, { recursive: true });
    const artifactName = process.env.SLICE_ARTIFACT ?? "vertical-slice.json";
    fs.writeFileSync(path.join(dir, artifactName), JSON.stringify(artifact, null, 2));
  });
});
