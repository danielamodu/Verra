/**
 * Bond-gated authorization tests (stubbed chain + stubbed bond gate).
 *
 * Proves the backend fails CLOSED when the verifier is not adequately bonded,
 * and proceeds to settlement when the bond is active and sufficient. The
 * existing USDC regression suite (settlement.test.ts) runs with NO bond gate
 * configured and is unaffected — that is the clean baseline/fallback.
 */
import { assert } from "chai";
import { Keypair, PublicKey } from "@solana/web3.js";
import { getPrisma } from "../src/infrastructure/db/client";
import {
  request, testApp, wipe, closePrisma, REQS, validSubmissionPayload,
} from "./helpers";

const BIZ = Keypair.generate().publicKey.toBase58();
const WORKER = Keypair.generate().publicKey.toBase58();
const MINT = Keypair.generate().publicKey.toBase58();
const PROGRAM = "EmAPVEMNMa5vmS2GaFSjfNjg1JeWyUhy4fCe3c6PyoMp";

type BondOpt = { active: boolean; amount: bigint } | "throw" | null;

function stubSolana(opts: {
  verifier: string;
  keypair: any;
  calls: { verify: number; release: number };
  balances?: number[];
  bond: BondOpt;
  minBond?: bigint;
}) {
  let balanceCalls = 0;
  const program: any = {
    methods: {
      verifyJob: () => ({ accounts: () => ({ signers: () => ({ rpc: async () => { opts.calls.verify += 1; return "verify-sig-stub"; } }) }) }),
      releasePayment: () => ({ accounts: () => ({ signers: () => ({ rpc: async () => { opts.calls.release += 1; return "release-sig-stub"; } }) }) }),
    },
    account: {
      job: {
        fetch: async () => ({
          state: { submitted: {} },
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
  const bond = {
    minBond: opts.minBond ?? 100n,
    skrMint: MINT,
    readBond: async () => {
      if (opts.bond === "throw") throw new Error("rpc down");
      if (opts.bond === null) return { exists: false, active: false, amount: 0n };
      return { exists: true, active: opts.bond.active, amount: opts.bond.amount };
    },
  };
  return { connection, program, programId: new PublicKey(PROGRAM), verifierKeypair: opts.keypair, bond } as any;
}

async function verifiedJob(db: any, jobId: string, jobPda: string, verifier: string) {
  const app = testApp(null);
  await request(app).post("/api/jobs").send({
    jobId, jobPda, business: BIZ, worker: WORKER, verifier,
    title: "Inspect 10 stores", paymentAmount: 150_000_000, usdcMint: MINT, requirements: REQS,
  });
  const job = await db.job.findUnique({ where: { jobId } });
  await db.job.update({ where: { id: job!.id }, data: { state: "IN_PROGRESS" } });
  const sub = validSubmissionPayload(jobId, WORKER, `sub-${jobId}`);
  assert.equal((await request(app).post("/api/submissions").send(sub)).status, 201);
  const ver = await request(app).post(`/api/verification/sub-${jobId}`).send();
  assert.equal(ver.body.result.status, "VERIFIED");
}

describe("bond-gated settlement authorization", () => {
  const db = getPrisma();
  beforeEach(async () => wipe(db));
  after(async () => closePrisma());

  it("blocks an unbonded verifier (fail closed, no chain, no row)", async () => {
    const keypair = Keypair.generate();
    const verifier = keypair.publicKey.toBase58();
    await verifiedJob(db, "7001", "PDA7001111111111111111111111111111111111111", verifier);
    const calls = { verify: 0, release: 0 };
    const stubApp = testApp(stubSolana({ verifier, keypair, calls, bond: null }));
    const res = await request(stubApp).post("/api/settle").send({ jobId: "7001" });
    assert.equal(res.status, 422);
    assert.equal(calls.verify, 0);
    assert.equal(calls.release, 0);
    assert.equal(await db.settlement.count(), 0);
  });

  it("blocks a verifier whose bond is below the minimum", async () => {
    const keypair = Keypair.generate();
    const verifier = keypair.publicKey.toBase58();
    await verifiedJob(db, "7002", "PDA7002111111111111111111111111111111111111", verifier);
    const calls = { verify: 0, release: 0 };
    const stubApp = testApp(stubSolana({ verifier, keypair, calls, bond: { active: true, amount: 50n }, minBond: 100n }));
    const res = await request(stubApp).post("/api/settle").send({ jobId: "7002" });
    assert.equal(res.status, 422);
    assert.equal(await db.settlement.count(), 0);
  });

  it("blocks when the bond read fails (fail closed)", async () => {
    const keypair = Keypair.generate();
    const verifier = keypair.publicKey.toBase58();
    await verifiedJob(db, "7003", "PDA7003111111111111111111111111111111111111", verifier);
    const calls = { verify: 0, release: 0 };
    const stubApp = testApp(stubSolana({ verifier, keypair, calls, bond: "throw" }));
    const res = await request(stubApp).post("/api/settle").send({ jobId: "7003" });
    assert.equal(res.status, 422);
    assert.equal(await db.settlement.count(), 0);
  });

  it("allows a sufficiently bonded verifier to settle (CONFIRMED)", async () => {
    const keypair = Keypair.generate();
    const verifier = keypair.publicKey.toBase58();
    await verifiedJob(db, "7004", "PDA7004111111111111111111111111111111111111", verifier);
    const calls = { verify: 0, release: 0 };
    const stubApp = testApp(stubSolana({
      verifier, keypair, calls, balances: [0, 150_000_000], bond: { active: true, amount: 150n }, minBond: 100n,
    }));
    const res = await request(stubApp).post("/api/settle").send({ jobId: "7004" });
    assert.equal(res.status, 200);
    assert.equal(res.body.status, "CONFIRMED");
    assert.equal(calls.verify, 1);
    assert.equal(calls.release, 1);
    const job = await db.job.findUnique({ where: { jobId: "7004" } });
    assert.equal(job?.state, "SETTLED");
  });
});
