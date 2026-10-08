/**
 * Settlement state machine tests with a stubbed chain executor.
 * These prove idempotency, retry, and failure semantics. The REAL
 * executor path (live RPC + keypair) is proven by vertical-slice.test.ts.
 */
import { assert } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getPrisma } from "../src/infrastructure/db/client";
import {
  assertNoSecrets, request, testApp, wipe, closePrisma, REQS, validSubmissionPayload,
} from "./helpers";

// Real on-curve addresses (ephemeral, generated per run): the settlement
// path parses them into PublicKeys, so opaque placeholders won't do.
const BIZ = Keypair.generate().publicKey.toBase58();
const WORKER = Keypair.generate().publicKey.toBase58();
const MINT = Keypair.generate().publicKey.toBase58();
const PROGRAM = "EmAPVEMNMa5vmS2GaFSjfNjg1JeWyUhy4fCe3c6PyoMp";

function stubSolana(opts: {
  verifier: string;
  chainState?: string;
  balances?: number[];
  keypair: any;
  calls: { verify: number; release: number };
}) {
  let balanceCalls = 0;
  const methods = {
    verifyJob: () => ({
      accounts: () => ({
        signers: () => ({ rpc: async () => { opts.calls.verify += 1; return "verify-sig-stub"; } }),
      }),
    }),
    releasePayment: () => ({
      accounts: () => ({
        signers: () => ({ rpc: async () => { opts.calls.release += 1; return "release-sig-stub"; } }),
      }),
    }),
  };
  const program: any = {
    methods,
    account: {
      // Chain starts SUBMITTED (worker submitted, nobody verified yet) —
      // the flow under test sends verify_job itself.
      job: {
        fetch: async () => ({
          state: { [opts.chainState ?? "submitted"]: {} },
          paymentAmount: { toNumber: () => 150_000_000 },
          worker: { toBase58: () => WORKER },
          business: { toBase58: () => BIZ },
          usdcMint: { toBase58: () => MINT },
        }),
      },
    },
  };
  const connection: any = {
    confirmTransaction: async () => ({ value: { err: null } }),
    getLatestBlockhash: async () => ({ blockhash: "b", lastValidBlockHeight: 1 }),
    getTokenAccountBalance: async () => {
      const v = opts.balances ? opts.balances[Math.min(balanceCalls, opts.balances.length - 1)] : 0;
      balanceCalls += 1;
      return { value: { amount: String(v) } };
    },
  };
  return {
    connection,
    program,
    programId: new PublicKey(PROGRAM),
    verifierKeypair: opts.keypair,
  } as any;
}

async function verifiedJob(db: any, jobId: string, jobPda: string, verifier: string) {
  const app = testApp(null);
  await request(app).post("/api/jobs").send({
    jobId,
    jobPda,
    business: BIZ,
    worker: WORKER,
    verifier,
    title: "Inspect 10 stores",
    paymentAmount: 150_000_000,
    usdcMint: MINT,
    requirements: REQS,
  });
  const job = await db.job.findUnique({ where: { jobId } });
  await db.job.update({ where: { id: job!.id }, data: { state: "IN_PROGRESS" } });
  const sub = validSubmissionPayload(jobId, WORKER, `sub-${jobId}`);
  assert.equal((await request(app).post("/api/submissions").send(sub)).status, 201);
  const ver = await request(app).post(`/api/verification/sub-${jobId}`).send();
  assert.equal(ver.body.result.status, "VERIFIED");
  return app;
}

describe("settlement domain (stub executor)", () => {
  const db = getPrisma();

  beforeEach(async () => wipe(db));
  after(async () => closePrisma());

  it("confirms settlement and returns receipt data", async () => {
    const keypair = Keypair.generate();
    const verifier = keypair.publicKey.toBase58();
    const app = await verifiedJob(db, "9301", "PDA9301111111111111111111111111111111111111", verifier);
    const calls = { verify: 0, release: 0 };
    const stubApp = testApp(stubSolana({ verifier, keypair, calls, balances: [0, 150_000_000] }));
    const res = await request(stubApp).post("/api/settle").send({ jobId: "9301" });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "CONFIRMED");
    assert.equal(res.body.verifyTx, "verify-sig-stub");
    assert.equal(res.body.releaseTx, "release-sig-stub");
    assertNoSecrets(res.body);
    const job = await db.job.findUnique({ where: { jobId: "9301" } });
    assert.equal(job?.state, "SETTLED");
  });

  it("replays CONFIRMED without new transactions (no double-pay)", async () => {
    const keypair = Keypair.generate();
    const verifier = keypair.publicKey.toBase58();
    const app = await verifiedJob(db, "9302", "PDA9302111111111111111111111111111111111111", verifier);
    void app;
    const calls = { verify: 0, release: 0 };
    const stubApp = testApp(stubSolana({ verifier, keypair, calls, balances: [0, 150_000_000] }));
    await request(stubApp).post("/api/settle").send({ jobId: "9302" });
    const replay = await request(stubApp).post("/api/settle").send({ jobId: "9302" });
    assert.equal(replay.status, 200);
    assert.equal(replay.body.status, "CONFIRMED");
    assert.equal(calls.verify, 1);
    assert.equal(calls.release, 1);
    assert.equal(await db.settlement.count(), 1);
  });

  it("refuses while a settlement is busy", async () => {
    const keypair = Keypair.generate();
    await verifiedJob(db, "9303", "PDA9303111111111111111111111111111111111111", keypair.publicKey.toBase58());
    const job = await db.job.findUnique({ where: { jobId: "9303" } });
    const att = await db.verificationAttestation.findFirst({ where: { jobId: job!.id } });
    await db.settlement.create({
      data: { jobId: job!.id, attestationId: att!.id, status: "RELEASING", amount: BigInt(150_000_000), recipient: job!.worker },
    });
    const stubApp = testApp(stubSolana({ verifier: keypair.publicKey.toBase58(), keypair, calls: { verify: 0, release: 0 } }));
    const res = await request(stubApp).post("/api/settle").send({ jobId: "9303" });
    assert.equal(res.status, 409);
  });

  it("retries FAILED settlements", async () => {
    const keypair = Keypair.generate();
    const verifier = keypair.publicKey.toBase58();
    await verifiedJob(db, "9304", "PDA9304111111111111111111111111111111111111", verifier);
    const job = await db.job.findUnique({ where: { jobId: "9304" } });
    const att = await db.verificationAttestation.findFirst({ where: { jobId: job!.id } });
    await db.settlement.create({
      data: { jobId: job!.id, attestationId: att!.id, status: "FAILED", amount: BigInt(150_000_000), recipient: job!.worker, error: "old" },
    });
    const calls = { verify: 0, release: 0 };
    const stubApp = testApp(stubSolana({ verifier, keypair, calls, balances: [0, 150_000_000] }));
    const res = await request(stubApp).post("/api/settle").send({ jobId: "9304" });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "CONFIRMED");
  });

  it("skips re-sending verify when the chain is already VERIFIED", async () => {
    const keypair = Keypair.generate();
    const verifier = keypair.publicKey.toBase58();
    await verifiedJob(db, "9308", "PDA9308111111111111111111111111111111111111", verifier);
    const job = await db.job.findUnique({ where: { jobId: "9308" } });
    const att = await db.verificationAttestation.findFirst({ where: { jobId: job!.id } });
    await db.settlement.create({
      data: { jobId: job!.id, attestationId: att!.id, status: "FAILED", amount: BigInt(150_000_000), recipient: job!.worker, error: "crashed after verify" },
    });
    const calls = { verify: 0, release: 0 };
    const stubApp = testApp(stubSolana({ verifier, keypair, calls, balances: [0, 150_000_000], chainState: "verified" }));
    const res = await request(stubApp).post("/api/settle").send({ jobId: "9308" });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "CONFIRMED");
    assert.equal(calls.verify, 0, "verify_job must not be re-sent");
    assert.equal(calls.release, 1);
  });

  it("fails without confirming on transfer mismatch", async () => {
    const keypair = Keypair.generate();
    const verifier = keypair.publicKey.toBase58();
    await verifiedJob(db, "9305", "PDA9305111111111111111111111111111111111111", verifier);
    const calls = { verify: 0, release: 0 };
    const stubApp = testApp(stubSolana({ verifier, keypair, calls, balances: [0, 1_000_000] }));
    const res = await request(stubApp).post("/api/settle").send({ jobId: "9305" });
    assert.equal(res.status, 502);
    const row = await db.settlement.findFirst({ where: { job: { jobId: "9305" } } });
    assert.equal(row?.status, "FAILED");
    const job = await db.job.findUnique({ where: { jobId: "9305" } });
    assert.equal(job?.state, "VERIFIED");
  });

  it("refuses unsettled jobs (unauthorized settlement)", async () => {
    const keypair = Keypair.generate();
    await verifiedJob(db, "9306", "PDA9306111111111111111111111111111111111111", keypair.publicKey.toBase58());
    await db.job.update({ where: { jobId: "9306" }, data: { state: "SUBMITTED" } });
    const stubApp = testApp(stubSolana({ verifier: keypair.publicKey.toBase58(), keypair, calls: { verify: 0, release: 0 } }));
    const res = await request(stubApp).post("/api/settle").send({ jobId: "9306" });
    assert.equal(res.status, 422);
    assert.equal(await db.settlement.count(), 0);
  });

  it("refuses tampered attestations", async () => {
    const keypair = Keypair.generate();
    const verifier = keypair.publicKey.toBase58();
    await verifiedJob(db, "9307", "PDA9307111111111111111111111111111111111111", verifier);
    const job = await db.job.findUnique({ where: { jobId: "9307" } });
    const att = await db.verificationAttestation.findFirst({ where: { jobId: job!.id } });
    await db.verificationAttestation.update({
      where: { id: att!.id },
      data: { reason: "edited" },
    });
    const stubApp = testApp(stubSolana({ verifier, keypair, calls: { verify: 0, release: 0 } }));
    const res = await request(stubApp).post("/api/settle").send({ jobId: "9307" });
    assert.equal(res.status, 422);
  });
});
