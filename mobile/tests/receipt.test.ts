/** Receipt view-model: pure mapping from attestation + settlement. */
import { buildReceiptView } from "../src/lib/receipt";
import { attestationDigest, buildAttestation } from "../../verification/attestation";
import { validStoreSubmission } from "../../verification/example-job";
import { verifySubmission } from "../../verification/engine";
import { storeInspectionRequirements } from "../../verification/example-job";

const WORKER = "DemoWorkerWallet11111111111111111111111111111";

function verifiedAttestation() {
  const submission = validStoreSubmission({
    jobId: "demo-150",
    worker: WORKER,
    submissionId: "rcpt-sub-1",
    submittedAt: "2026-01-15T12:00:00.000Z",
  });
  const result = verifySubmission({
    requirements: storeInspectionRequirements(),
    submission,
    expectedJobId: "demo-150",
    expectedWorker: WORKER,
    now: Date.parse("2026-01-15T12:00:00.000Z") + 1000,
  });
  if (result.status !== "VERIFIED") throw new Error("fixture must verify");
  return buildAttestation({
    result,
    submission,
    verifier: "demo-verifier",
    deviceId: "test-android-id",
  });
}

describe("buildReceiptView", () => {
  it("real receipt shows SETTLED + transaction", () => {
    const view = buildReceiptView(
      "Inspect 10 stores",
      "#042",
      verifiedAttestation(),
      "22ssBFL3srbNFDATYsSwHL27AmKveocRLnhZzeYvr6pUCevWb79VFRBQJBMCCFc5LhMefmMuSRnJeeFz5DC78Ydq",
      150_000_000
    );
    expect(view.title).toBe("INSPECT 10 STORES");
    expect(view.amount).toBe("$150.00 USDC");
    expect(view.stateLabel).toBe("SETTLED");
    expect(view.txShort).toContain("…");
    expect(view.demo).toBe(false);
    expect(view.lines.map((l) => l.ok)).toEqual([true, true, true, true, true]);
  });

  it("demo receipt is explicitly not settled", () => {
    const view = buildReceiptView("Inspect 10 stores", "#042", verifiedAttestation(), null, 150_000_000);
    expect(view.demo).toBe(true);
    expect(view.txShort).toBeNull();
    expect(view.stateLabel).toBe("VERIFIED");
  });

  it("shared attestation digest is stable across import contexts", () => {
    const a = verifiedAttestation();
    // Same content built twice → same digest (deterministic cross-platform).
    const again = buildReceiptView("x", "#1", a, null, 1);
    expect(again.lines.length).toBe(5);
    expect(typeof attestationDigest(a)).toBe("string");
    expect(attestationDigest(a)).toMatch(/^[0-9a-f]{64}$/);
  });
});
