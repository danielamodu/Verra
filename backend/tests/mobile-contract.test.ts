/**
 * Mobile/backend contract: payloads built by the phone's own
 * submissionFromDraft must validate against POST /api/submissions.
 */
import { assert } from "chai";
import { getPrisma } from "../src/infrastructure/db/client";
import { submissionFromDraft } from "../../mobile/src/backend/types";
import { storeInspectionRequirements } from "../../verification/example-job";
import { request, testApp, wipe, closePrisma, REQS } from "./helpers";

const BIZ = "Biz111111111111111111111111111111111111111";
const WORKER = "Worker1111111111111111111111111111111111111";

describe("mobile contract", () => {
  const db = getPrisma();
  const app = testApp(null);

  beforeEach(async () => wipe(db));
  after(async () => closePrisma());

  it("accepts the phone-shaped submission payload", async () => {
    const job = await db.job.create({
      data: {
        jobId: "9401",
        jobPda: "PDA9401111111111111111111111111111111111111",
        business: BIZ,
        worker: WORKER,
        verifier: "Verifier11111111111111111111111111111111111",
        title: "Inspect 10 stores",
        paymentAmount: BigInt(150_000_000),
        usdcMint: "Mint111111111111111111111111111111111111111",
        state: "IN_PROGRESS",
        requirements: storeInspectionRequirements() as any,
      },
    });
    void job;
    void REQS;
    const draft = submissionFromDraft(
      {
        id: "9401",
        title: "t",
        description: "",
        paymentBaseUnits: 150_000_000,
        business: BIZ,
        worker: WORKER,
        chainState: "IN_PROGRESS",
        requirements: storeInspectionRequirements(),
        activity: [],
      } as any,
      WORKER,
      "sub-mobile-1",
      ["visit-checklist"],
      Array.from({ length: 10 }, (_, i) => ({
        requirementId: "store-photos",
        uri: `local://photo-${i}.jpg`,
        contentHash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        mimeType: "image/jpeg",
        capturedAt: "2026-01-15T11:00:00.000Z",
      })),
      "2026-01-15T12:00:00.000Z"
    );
    const res = await request(app).post("/api/submissions").send({
      jobId: draft.job_id,
      worker: draft.worker,
      submissionId: draft.submission_id,
      checklistResults: draft.checklist_results,
      evidence: draft.evidence.map((e) => ({
        requirementId: e.requirement_id,
        type: e.type,
        storageRef: e.storage_ref,
        contentHash: e.content_hash,
        capturedAt: e.captured_at,
        metadata: e.metadata,
      })),
      submittedAt: draft.submitted_at,
    });
    assert.equal(res.status, 201);
  });
});
