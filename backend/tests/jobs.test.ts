import { assert } from "chai";
import { getPrisma } from "../src/infrastructure/db/client";
import { assertNoSecrets, request, testApp, wipe, closePrisma, REQS } from "./helpers";

const JOB = {
  jobId: "9001",
  jobPda: "PDA9001111111111111111111111111111111111111",
  business: "Biz111111111111111111111111111111111111111",
  worker: "Worker1111111111111111111111111111111111111",
  verifier: "Verifier11111111111111111111111111111111111",
  title: "Inspect 10 stores",
  paymentAmount: 150_000_000,
  usdcMint: "Mint111111111111111111111111111111111111111",
  requirements: REQS,
};

describe("jobs api", () => {
  const db = getPrisma();
  const app = testApp(null);

  beforeEach(async () => wipe(db));
  after(async () => closePrisma());

  it("registers a job as CREATED", async () => {
    const res = await request(app).post("/api/jobs").send(JOB);
    assert.equal(res.status, 201);
    assert.equal(res.body.state, "CREATED");
    assertNoSecrets(res.body);
  });

  it("rejects duplicate jobId/jobPda", async () => {
    await request(app).post("/api/jobs").send(JOB);
    const res = await request(app).post("/api/jobs").send(JOB);
    assert.equal(res.status, 409);
  });

  it("rejects invalid amounts and wallets", async () => {
    const badAmount = await request(app).post("/api/jobs").send({ ...JOB, jobId: "x1", jobPda: "PDAx111111111111111111111111111111111111111", paymentAmount: 0 });
    assert.equal(badAmount.status, 400);
    const badWallet = await request(app).post("/api/jobs").send({ ...JOB, jobId: "x2", jobPda: "PDAx211111111111111111111111111111111111111", worker: "not-base58!!" });
    assert.equal(badWallet.status, 400);
  });

  it("returns 404 for unknown jobs", async () => {
    const res = await request(app).get("/api/jobs/nope");
    assert.equal(res.status, 404);
  });

  it("accept requires the assigned worker", async () => {
    const created = await request(app).post("/api/jobs").send(JOB);
    await db.job.update({ where: { id: created.body.id }, data: { state: "FUNDED" } });
    const wrong = await request(app)
      .post(`/api/jobs/${created.body.id}/accept`)
      .send({ worker: JOB.business, acceptTx: "sig" });
    assert.equal(wrong.status, 422);
  });
});
