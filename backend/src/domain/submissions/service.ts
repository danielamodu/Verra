/**
 * Submission intake: validate → persist (submission + evidence rows) →
 * SUBMITTED activity + job transition. Deep semantic verdicts belong to
 * the verification domain (engine); intake enforces structural integrity
 * and authenticity, then persists everything for audit.
 */
import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { ApiError, conflict } from "../../api/errors";
import { logger } from "../../logger";
import { submissionCommitment, verifyWorkerSignature } from "../../../../verification/attestation";
import { isWellFormedHash } from "../../../../verification/evidence";
import { appendActivity } from "../activity/log";
import { transitionJob } from "../jobs/service";
import type { EvidenceStore } from "../../infrastructure/storage/evidenceStore";

const evidenceSchema = z.object({
  requirementId: z.string().min(1),
  type: z.string().min(1),
  storageRef: z.string().min(1),
  contentHash: z.string().min(1),
  capturedAt: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
  contentBase64: z.string().optional(),
});

const checklistResultSchema = z.object({
  requirement_id: z.string().min(1),
  completed: z.boolean(),
});

export const submissionRequestSchema = z.object({
  jobId: z.string().min(1),
  worker: z.string().min(1),
  submissionId: z.string().min(1),
  checklistResults: z.array(checklistResultSchema),
  evidence: z.array(evidenceSchema),
  workerSignature: z.string().optional(),
  submittedAt: z.string().min(1),
});

export type SubmissionRequest = z.infer<typeof submissionRequestSchema>;

function parseDate(value: string, field: string): Date {
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new ApiError("VALIDATION_ERROR", `${field} must be a valid timestamp`);
  return new Date(t);
}

export async function intakeSubmission(
  db: PrismaClient,
  store: EvidenceStore,
  body: unknown
) {
  const parsed = submissionRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError("VALIDATION_ERROR", "Invalid submission payload", parsed.error.flatten());
  }
  const req = parsed.data;

  // Idempotency first: a known submissionId always reports conflict,
  // regardless of current job state (plus a P2002 race guard below).
  const duplicate = await db.submission.findUnique({ where: { id: req.submissionId } });
  if (duplicate) throw conflict("Duplicate submissionId (resubmissions need a new id)");

  const job = await db.job.findUnique({ where: { jobId: req.jobId } });
  if (!job) throw new ApiError("NOT_FOUND", "Job not found");
  if (job.state !== "IN_PROGRESS" && job.state !== "REJECTED") {
    throw new ApiError("UNPROCESSABLE", `Job does not accept submissions in state ${job.state}`);
  }
  if (req.worker !== job.worker) {
    throw new ApiError("UNPROCESSABLE", "Submission worker does not match assigned worker");
  }
  const submittedAt = parseDate(req.submittedAt, "submittedAt");

  for (const e of req.evidence) {
    if (!isWellFormedHash(e.contentHash)) {
      throw new ApiError("VALIDATION_ERROR", `Evidence for '${e.requirementId}' has an invalid contentHash`);
    }
    const captured = parseDate(e.capturedAt, "capturedAt");
    if (captured.getTime() > submittedAt.getTime()) {
      throw new ApiError("VALIDATION_ERROR", "Evidence capturedAt is after submittedAt");
    }
    if (e.contentBase64) {
      try {
        store.put(e.contentHash, e.contentBase64);
      } catch (err: any) {
        throw new ApiError("VALIDATION_ERROR", err.message);
      }
    }
  }

  const commitment = submissionCommitment({
    job_id: req.jobId,
    submission_id: req.submissionId,
    worker: req.worker,
    checklist_results: req.checklistResults as any,
    evidence: req.evidence.map((e, i) => ({
      id: `ev-${i + 1}`,
      requirement_id: e.requirementId,
      type: "PHOTO_EVIDENCE" as const,
      storage_ref: e.storageRef,
      captured_at: e.capturedAt,
      content_hash: e.contentHash,
      metadata: e.metadata ?? {},
    })),
  });

  if (req.workerSignature) {
    const ok = verifyWorkerSignature(req.worker, commitment, req.workerSignature);
    if (!ok) throw new ApiError("UNPROCESSABLE", "Invalid worker signature for this submission");
  }

  try {
    const submission = await db.submission.create({
      data: {
        id: req.submissionId,
        jobId: job.id,
        worker: req.worker,
        submittedAt,
        status: "RECEIVED",
        checklistResults: req.checklistResults as any,
        commitment,
        workerSignature: req.workerSignature,
        evidence: {
          create: req.evidence.map((e, i) => ({
            position: i,
            requirementId: e.requirementId,
            type: e.type,
            storageRef: e.storageRef,
            contentHash: e.contentHash.toLowerCase(),
            capturedAt: parseDate(e.capturedAt, "capturedAt"),
            metadata: (e.metadata ?? {}) as any,
          })),
        },
      },
      include: { evidence: true },
    });
    await transitionJob(db, job.id, "SUBMITTED", {
      type: "SUBMITTED",
      actor: req.worker,
    });
    logger.info("submission persisted", {
      jobId: job.id,
      submissionId: submission.id,
    });
    return submission;
  } catch (e: any) {
    if (e?.code === "P2002") throw conflict("Duplicate submissionId (resubmissions need a new id)");
    throw e;
  }
}
