/**
 * Offline mirror of the on-chain ProofPay state machine.
 *
 * The Anchor program is the source of truth; this file replicates its
 * transition table + authority checks in pure TypeScript so the core
 * protocol logic can be verified without a Solana validator
 * (`npm run test:unit`). The on-chain integration suite in
 * tests/proofpay.ts exercises the same transitions against the real program.
 */
import { assert } from "chai";

export enum JobState {
  Created = "Created",
  Funded = "Funded",
  InProgress = "InProgress",
  Submitted = "Submitted",
  Verified = "Verified",
  Rejected = "Rejected",
  Settled = "Settled",
}

export class ProofPayError extends Error {
  constructor(public code: string, msg: string) {
    super(`${code}: ${msg}`);
  }
}

export interface Job {
  jobId: number;
  business: string;
  worker: string;
  verifier: string;
  paymentAmount: number;
  usdcMint: string;
  state: JobState;
}

export function createJob(job: Omit<Job, "state">): Job {
  if (job.paymentAmount <= 0)
    throw new ProofPayError("InvalidPaymentAmount", "amount must be > 0");
  if (!job.worker) throw new ProofPayError("InvalidWorker", "worker required");
  if (!job.verifier)
    throw new ProofPayError("InvalidVerifier", "verifier required");
  if (job.worker === job.business)
    throw new ProofPayError(
      "WorkerCannotBeBusiness",
      "worker cannot be the business"
    );
  return { ...job, state: JobState.Created };
}

function requireState(job: Job, expected: JobState) {
  if (job.state !== expected)
    throw new ProofPayError(
      "InvalidStateTransition",
      `expected ${expected}, got ${job.state}`
    );
}

export function fundJob(job: Job, signer: string, mint: string, balance: number): Job {
  requireState(job, JobState.Created);
  if (signer !== job.business)
    throw new ProofPayError("UnauthorizedBusiness", "only business funds");
  if (mint !== job.usdcMint)
    throw new ProofPayError("InvalidMint", "mint mismatch");
  if (balance < job.paymentAmount)
    throw new ProofPayError("InsufficientFunds", "insufficient funds");
  return { ...job, state: JobState.Funded };
}

export function acceptJob(job: Job, signer: string): Job {
  requireState(job, JobState.Funded);
  if (signer !== job.worker)
    throw new ProofPayError("UnauthorizedWorker", "only assigned worker");
  return { ...job, state: JobState.InProgress };
}

export function submitJob(job: Job, signer: string): Job {
  requireState(job, JobState.InProgress);
  if (signer !== job.worker)
    throw new ProofPayError("UnauthorizedWorker", "only assigned worker");
  return { ...job, state: JobState.Submitted };
}

export function verifyJob(job: Job, signer: string): Job {
  requireState(job, JobState.Submitted);
  if (signer !== job.verifier)
    throw new ProofPayError("UnauthorizedVerifier", "only assigned verifier");
  return { ...job, state: JobState.Verified };
}

export function rejectJob(job: Job, signer: string): Job {
  requireState(job, JobState.Submitted);
  if (signer !== job.verifier)
    throw new ProofPayError("UnauthorizedVerifier", "only assigned verifier");
  return { ...job, state: JobState.Rejected };
}

export function resubmitJob(job: Job, signer: string): Job {
  requireState(job, JobState.Rejected);
  if (signer !== job.worker)
    throw new ProofPayError("UnauthorizedWorker", "only assigned worker");
  return { ...job, state: JobState.InProgress };
}

export function releasePayment(
  job: Job,
  signer: string,
  escrowBalance: number,
  workerAtaOwner: string,
  workerAtaMint: string
): { job: Job; payout: number } {
  if (job.state !== JobState.Verified)
    throw new ProofPayError(
      "PrematureRelease",
      "only VERIFIED jobs settle, exactly once"
    );
  if (signer !== job.verifier)
    throw new ProofPayError("UnauthorizedSettlement", "only verifier settles");
  if (workerAtaMint !== job.usdcMint)
    throw new ProofPayError("InvalidMint", "destination mint mismatch");
  if (workerAtaOwner !== job.worker)
    throw new ProofPayError(
      "InvalidWorkerDestination",
      "destination not owned by worker"
    );
  if (escrowBalance < job.paymentAmount)
    throw new ProofPayError("AmountMismatch", "escrow balance mismatch");
  return { job: { ...job, state: JobState.Settled }, payout: job.paymentAmount };
}

// ---------------------------------------------------------------------------

describe("proofpay state machine (offline mirror)", () => {
  const BIZ = "biz";
  const WORKER = "worker";
  const VERIFIER = "verifier";
  const ATTACKER = "attacker";
  const MINT = "usdc-mint";
  const FAKE_MINT = "fake-mint";
  const USD_150 = 150_000_000;

  const fresh = (amount = 1_000_000): Job =>
    createJob({
      jobId: 1,
      business: BIZ,
      worker: WORKER,
      verifier: VERIFIER,
      paymentAmount: amount,
      usdcMint: MINT,
    });

  const toVerified = (j: Job): Job => {
    let x = fundJob(j, BIZ, MINT, 10_000_000_000);
    x = acceptJob(x, WORKER);
    x = submitJob(x, WORKER);
    return verifyJob(x, VERIFIER);
  };

  it("create job", () => {
    assert.equal(fresh().state, JobState.Created);
  });

  it("fund job", () => {
    assert.equal(fundJob(fresh(), BIZ, MINT, 5_000_000).state, JobState.Funded);
  });

  it("accept job", () => {
    assert.equal(acceptJob(fundJob(fresh(), BIZ, MINT, 5_000_000), WORKER).state, JobState.InProgress);
  });

  it("submit valid job", () => {
    const j = acceptJob(fundJob(fresh(), BIZ, MINT, 5_000_000), WORKER);
    assert.equal(submitJob(j, WORKER).state, JobState.Submitted);
  });

  it("verify job", () => {
    const j = submitJob(
      acceptJob(fundJob(fresh(), BIZ, MINT, 5_000_000), WORKER),
      WORKER
    );
    assert.equal(verifyJob(j, VERIFIER).state, JobState.Verified);
  });

  it("release payment + worker receives USDC", () => {
    const { job, payout } = releasePayment(toVerified(fresh(5_000_000)), VERIFIER, 5_000_000, WORKER, MINT);
    assert.equal(job.state, JobState.Settled);
    assert.equal(payout, 5_000_000);
  });

  it("end-to-end: business funds $150 USDC → worker receives $150 USDC", () => {
    const { job, payout } = releasePayment(toVerified(fresh(USD_150)), VERIFIER, USD_150, WORKER, MINT);
    assert.equal(job.state, JobState.Settled);
    assert.equal(payout, USD_150);
  });

  it("invalid premature release fails", () => {
    const j = fundJob(fresh(), BIZ, MINT, 5_000_000);
    assert.throws(() => releasePayment(j, VERIFIER, 1_000_000, WORKER, MINT), /PrematureRelease/);
  });

  it("invalid worker cannot accept", () => {
    const j = fundJob(fresh(), BIZ, MINT, 5_000_000);
    assert.throws(() => acceptJob(j, ATTACKER), /UnauthorizedWorker/);
  });

  it("invalid verifier cannot verify", () => {
    const j = submitJob(acceptJob(fundJob(fresh(), BIZ, MINT, 5_000_000), WORKER), WORKER);
    assert.throws(() => verifyJob(j, ATTACKER), /UnauthorizedVerifier/);
  });

  it("rejected submission", () => {
    const j = submitJob(acceptJob(fundJob(fresh(), BIZ, MINT, 5_000_000), WORKER), WORKER);
    assert.equal(rejectJob(j, VERIFIER).state, JobState.Rejected);
  });

  it("resubmission", () => {
    const j = submitJob(acceptJob(fundJob(fresh(), BIZ, MINT, 5_000_000), WORKER), WORKER);
    const r = rejectJob(j, VERIFIER);
    const back = resubmitJob(r, WORKER);
    assert.equal(back.state, JobState.InProgress);
    assert.equal(submitJob(back, WORKER).state, JobState.Submitted);
  });

  it("double settlement fails", () => {
    const { job } = releasePayment(toVerified(fresh()), VERIFIER, 1_000_000, WORKER, MINT);
    assert.throws(() => releasePayment(job, VERIFIER, 1_000_000, WORKER, MINT), /PrematureRelease/);
  });

  it("incorrect USDC mint fails", () => {
    assert.throws(() => fundJob(fresh(), BIZ, FAKE_MINT, 5_000_000), /InvalidMint/);
  });

  it("unauthorized state transitions fail", () => {
    const j = fresh();
    assert.throws(() => submitJob(j, WORKER), /InvalidStateTransition/);
    assert.throws(() => verifyJob(j, VERIFIER), /InvalidStateTransition/);
    assert.throws(() => acceptJob(j, WORKER), /InvalidStateTransition/);
    assert.throws(() => releasePayment(j, ATTACKER, 1_000_000, WORKER, MINT), /PrematureRelease/);
  });
});
