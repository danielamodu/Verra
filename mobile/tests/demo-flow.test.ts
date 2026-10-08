/** LocalDemoBackend honesty: real engine verdicts, never a real receipt. */
import { LocalDemoBackend } from "../src/backend/LocalDemoBackend";
import {
  storeInspectionRequirements,
  validStoreSubmission,
} from "../../verification/example-job";

const WORKER = "DemoWorkerWallet11111111111111111111111111111";

describe("LocalDemoBackend", () => {
  it("full loop: create → accept → valid evidence → VERIFIED, no faked settlement", async () => {
    const backend = new LocalDemoBackend(false);
    const job = await backend.createJob(
      {
        title: "Inspect 10 stores",
        description: "demo",
        paymentBaseUnits: 150_000_000,
        worker: WORKER,
        requirements: storeInspectionRequirements(),
      },
      "biz"
    );
    expect(job.chainState).toBe("FUNDED");

    await backend.acceptJob(job.id, WORKER);
    expect((await backend.getJob(job.id)).chainState).toBe("IN_PROGRESS");

    const sub = validStoreSubmission({
      jobId: job.id,
      worker: WORKER,
      submissionId: "demo-sub-1",
      submittedAt: new Date().toISOString(),
    });
    const result = await backend.submitCompletion(job.id, {
      submissionId: sub.submission_id,
      completedChecklists: ["visit-checklist"],
      evidence: sub.evidence.map((e) => ({
        requirementId: e.requirement_id,
        uri: e.storage_ref.replace(/^local:/, ""),
        contentHash: e.content_hash,
        mimeType: "image/jpeg",
        capturedAt: e.captured_at,
      })),
    });
    expect(result.status).toBe("VERIFIED");
    expect((await backend.getJob(job.id)).chainState).toBe("VERIFIED");

    const receipt = await backend.releasePayment(job.id);
    expect(receipt.real).toBe(false);
    expect(receipt.signature).toBeUndefined();
    // State honestly stays VERIFIED — settlement is NOT faked.
    expect((await backend.getJob(job.id)).chainState).toBe("VERIFIED");
  });

  it("invalid evidence → REJECTED and release refuses", async () => {
    const backend = new LocalDemoBackend(false);
    const job = await backend.createJob(
      {
        title: "Bad job",
        description: "demo",
        paymentBaseUnits: 1_000_000,
        worker: WORKER,
        requirements: storeInspectionRequirements(),
      },
      "biz"
    );
    await backend.acceptJob(job.id, WORKER);
    const result = await backend.submitCompletion(job.id, {
      submissionId: "demo-sub-bad",
      completedChecklists: [],
      evidence: [],
    });
    expect(result.status).toBe("REJECTED");
    await expect(backend.releasePayment(job.id)).rejects.toThrow(/Only VERIFIED/);
  });
});
