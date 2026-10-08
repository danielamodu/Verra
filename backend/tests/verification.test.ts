import { assert } from "chai";
import { ed25519 } from "@noble/curves/ed25519";
import bs58 from "bs58";
import { getPrisma } from "../src/infrastructure/db/client";
import { verifyAttestationDigest } from "../src/domain/attestations/service";
import { submissionCommitment } from "../../verification/attestation";
import {
  assertNoSecrets, request, testApp, wipe, closePrisma, REQS, validSubmissionPayload,
} from "./helpers";

const BIZ = "Biz111111111111111111111111111111111111111";
const VERIFIER = "Verifier11111111111111111111111111111111111";

async function submittedJob(db: any, jobId: string, jobPda: string, worker: string) {
  const app = testApp(null);
  await db.job.create({
    data: {
      jobId,
      jobPda,
      business: BIZ,
      worker,
      verifier: VERIFIER,
      title: "Inspect 10 stores",
      paymentAmount: BigInt(150_000_000),
      usdcMint: "Mint111111111111111111111111111111111111111",
      state: "IN_PROGRESS",
      requirements: REQS,
    },
  });
  return app;
}

describe("verification domain", () => {
  const db = getPrisma();

  beforeEach(async () => wipe(db));
  after(async () => closePrisma());

  it("VERIFIED attempt mints a digest-pinned attestation", async () => {
    const priv = ed25519.utils.randomPrivateKey();
    const worker58 = bs58.encode(ed25519.getPublicKey(priv));
    const app = await submittedJob(db, "9201", "PDA9201111111111111111111111111111111111111", worker58);
    const payload = validSubmissionPayload("9201", worker58, "sub-9201");
    const commitment = submissionCommitment({
      job_id: "9201",
      submission_id: "sub-9201",
      worker: worker58,
      checklist_results: payload.checklistResults as any,
      evidence: payload.evidence.map((e, i) => ({
        id: `ev-${i + 1}`,
        requirement_id: e.requirementId,
        content_hash: e.contentHash,
      })) as any,
    });
    const sig = Buffer.from(ed25519.sign(Buffer.from(commitment, "hex"), priv)).toString("base64");
    const sub = await request(app).post("/api/submissions").send({ ...payload, workerSignature: sig });
    assert.equal(sub.status, 201);

    const ver = await request(app).post("/api/verification/sub-9201").send();
    assert.equal(ver.body.result.status, "VERIFIED");
    assert.isString(ver.body.attestationId);

    const att = await db.verificationAttestation.findUnique({
      where: { id: ver.body.attestationId },
    });
    assert.isNotNull(att);
    assert.equal(att!.workerSignature, sig);
    assert.isTrue(verifyAttestationDigest(att as any, "9201"));
    assertNoSecrets(ver.body);

    const job = await db.job.findUnique({ where: { jobId: "9201" } });
    assert.equal(job?.state, "VERIFIED");
    const latest = await request(app).get("/api/verification/sub-9201");
    assert.equal(latest.body.status, "VERIFIED");
  });

  it("REJECTED attempt persists reason, creates nothing settleable", async () => {
    const worker58 = bs58.encode(ed25519.getPublicKey(ed25519.utils.randomPrivateKey()));
    const app = await submittedJob(db, "9202", "PDA9202111111111111111111111111111111111111", worker58);
    const bad = validSubmissionPayload("9202", worker58, "sub-9202");
    bad.checklistResults = [{ requirement_id: "visit-checklist", completed: false }];
    assert.equal((await request(app).post("/api/submissions").send(bad)).status, 201);

    const ver = await request(app).post("/api/verification/sub-9202").send();
    assert.equal(ver.body.result.status, "REJECTED");
    assert.isNull(ver.body.attestationId);

    assert.equal(await db.verificationAttestation.count(), 0);
    const job = await db.job.findUnique({ where: { jobId: "9202" } });
    assert.equal(job?.state, "REJECTED");

    // Nothing settleable exists for a rejected job.
    const settle = await request(app).post("/api/settle").send({ jobId: "9202" });
    assert.notEqual(settle.status, 200);
  });

  it("tampered attestation rows fail digest validation", async () => {
    const worker58 = bs58.encode(ed25519.getPublicKey(ed25519.utils.randomPrivateKey()));
    const app = await submittedJob(db, "9203", "PDA9203111111111111111111111111111111111111", worker58);
    await request(app).post("/api/submissions").send(validSubmissionPayload("9203", worker58, "sub-9203"));
    const ver = await request(app).post("/api/verification/sub-9203").send();
    const att = await db.verificationAttestation.findUnique({ where: { id: ver.body.attestationId } });
    await db.verificationAttestation.update({
      where: { id: att!.id },
      data: { reason: "edited by attacker" },
    });
    const edited = await db.verificationAttestation.findUnique({ where: { id: att!.id } });
    assert.isFalse(verifyAttestationDigest(edited as any, "9203"));
  });
});
