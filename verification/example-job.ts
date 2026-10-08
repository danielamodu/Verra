/**
 * Example job: "Inspect 10 stores" — 150 USDC.
 *
 * Requirements:
 *   - `visit-checklist` (CHECKLIST, required): all 10 store visits completed.
 *   - `store-photos` (PHOTO_EVIDENCE, required): at least one photo per store.
 */
import { sha256Hex } from "./evidence";
import type { Evidence, Requirement, Submission } from "./schema";

export function storeInspectionRequirements(): Requirement[] {
  const stores = Array.from({ length: 10 }, (_, i) => {
    const n = String(i + 1).padStart(2, "0");
    return { id: `store-${n}`, label: `Store ${n} inspected` };
  });
  return [
    {
      id: "visit-checklist",
      type: "CHECKLIST",
      label: "Complete the 10-store inspection checklist",
      required: true,
      configuration: { items: stores },
    },
    {
      id: "store-photos",
      type: "PHOTO_EVIDENCE",
      label: "Submit one photo per inspected store",
      required: true,
      configuration: { minPhotos: 10 },
    },
  ];
}

/** Build a photo Evidence item with a correct SHA-256 content hash. */
export function photoEvidence(
  id: string,
  requirementId: string,
  storeN: string,
  content: Uint8Array | string,
  capturedAt: string
): Evidence {
  return {
    id,
    requirement_id: requirementId,
    type: "PHOTO_EVIDENCE",
    storage_ref: `evidence://${requirementId}/${storeN}.jpg`,
    captured_at: capturedAt,
    content_hash: sha256Hex(content),
    metadata: {
      mimeType: "image/jpeg",
      store: storeN,
      sizeBytes:
        typeof content === "string" ? Buffer.byteLength(content, "utf8") : content.length,
    },
  };
}

/** A fully valid submission for the 10-store job (for tests/docs). */
export function validStoreSubmission(args: {
  jobId: string;
  worker: string;
  submissionId: string;
  submittedAt: string;
}): Submission {
  const evidence: Evidence[] = [];
  for (let i = 1; i <= 10; i++) {
    const n = String(i).padStart(2, "0");
    evidence.push(
      photoEvidence(`ev-${n}`, "store-photos", `store-${n}`, `photo-bytes-store-${n}`, args.submittedAt)
    );
  }
  return {
    job_id: args.jobId,
    worker: args.worker,
    submitted_at: args.submittedAt,
    submission_id: args.submissionId,
    checklist_results: [{ requirement_id: "visit-checklist", completed: true }],
    evidence,
  };
}
