import { assert } from "chai";
import { getPrisma } from "../src/infrastructure/db/client";
import {
  assertNoSecrets, request, testApp, wipe, closePrisma, REQS, validSubmissionPayload,
} from "./helpers";

const BIZ = "Biz111111111111111111111111111111111111111";
const WORKER = "Worker1111111111111111111111111111111111111";
const VERIFIER = "Verifier11111111111111111111111111111111111";

async function fundedJob(db: any, jobId: string, jobPda: string) {
  const job = await db.job.create({
    data: {
      jobId,
      jobPda,
      business: BIZ,
      worker: WORKER,
      verifier: VERIFIER,
      title: "Inspect 10 stores",
      paymentAmount: BigInt(150_000_000),
      usdcMint: "Mint111111111111111111111111111111111111111",
      state: "IN_PROGRESS",
      requirements: REQS,
    },
  });
  return job;
}

describe("submissions api", () => {
  const db = getPrisma();
  const app = testApp(null);

  beforeEach(async () => wipe(db));
  after(async () => closePrisma());

  it("persists a valid submission and moves the job to SUBMITTED", async () => {
    await fundedJob(db, "9101", "PDA9101111111111111111111111111111111111111");
    const res = await request(app)
      .post("/api/submissions")
      .send(validSubmissionPayload("9101", WORKER, "sub-9101"));
    assert.equal(res.status, 201);
    assert.equal(res.body.commitment?.length, 64);
    assertNoSecrets(res.body);
    const job = await db.job.findUnique({ where: { jobId: "9101" } });
    assert.equal(job?.state, "SUBMITTED");
    const events = await db.activityEvent.findMany({ where: { jobId: job!.id } });
    assert.isTrue(events.some((e) => e.type === "SUBMITTED"));
  });

  it("rejects duplicate submissionIds (idempotent intake)", async () => {
    await fundedJob(db, "9102", "PDA9102111111111111111111111111111111111111");
    const payload = validSubmissionPayload("9102", WORKER, "sub-dup");
    assert.equal((await request(app).post("/api/submissions").send(payload)).status, 201);
    const res = await request(app).post("/api/submissions").send(payload);
    assert.equal(res.status, 409);
  });

  it("rejects wrong worker", async () => {
    await fundedJob(db, "9103", "PDA9103111111111111111111111111111111111111");
    const res = await request(app)
      .post("/api/submissions")
      .send({ ...validSubmissionPayload("9103", WORKER, "sub-x"), worker: BIZ });
    assert.equal(res.status, 422);
  });

  it("rejects malformed hashes and bad timestamps", async () => {
    await fundedJob(db, "9104", "PDA9104111111111111111111111111111111111111");
    const bad = validSubmissionPayload("9104", WORKER, "sub-bad");
    (bad.evidence[0] as any).contentHash = "zz";
    assert.equal((await request(app).post("/api/submissions").send(bad)).status, 400);
  });

  it("rejects invalid worker signatures", async () => {
    await fundedJob(db, "9105", "PDA9105111111111111111111111111111111111111");
    const payload = {
      ...validSubmissionPayload("9105", WORKER, "sub-sig"),
      workerSignature: Buffer.from("not-a-real-signature").toString("base64"),
    };
    const res = await request(app).post("/api/submissions").send(payload);
    assert.equal(res.status, 422);
  });

  it("never accepts client-provided verdicts", async () => {
    await fundedJob(db, "9106", "PDA9106111111111111111111111111111111111111");
    const res = await request(app)
      .post("/api/submissions")
      .send({ ...validSubmissionPayload("9106", WORKER, "sub-v"), verified: true });
    assert.equal(res.status, 400);
  });

  it("rejects submissions for jobs in the wrong state", async () => {
    await db.job.create({
      data: {
        jobId: "9107",
        jobPda: "PDA9107111111111111111111111111111111111111",
        business: BIZ,
        worker: WORKER,
        verifier: VERIFIER,
        title: "t",
        paymentAmount: BigInt(1),
        usdcMint: "Mint111111111111111111111111111111111111111",
        state: "FUNDED",
        requirements: REQS,
      },
    });
    const res = await request(app)
      .post("/api/submissions")
      .send(validSubmissionPayload("9107", WORKER, "sub-early"));
    assert.equal(res.status, 422);
  });
});
