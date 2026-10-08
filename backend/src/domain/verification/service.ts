/**
 * Verification domain: run the existing deterministic engine over a stored
 * submission, persist every attempt, and mint an attestation for VERIFIED.
 * REJECTED results never produce an authorization ticket — there is no code
 * path from a failed attempt to settlement.
 */
import type { PrismaClient } from "@prisma/client";
import { ApiError } from "../../api/errors";
import { logger } from "../../logger";
import { verifySubmission } from "../../../../verification/engine";
import { VerificationService } from "../../../../verification/service";
import type {
  Evidence as EngineEvidence,
  Requirement,
  Submission as EngineSubmission,
  VerificationResult,
} from "../../../../verification/schema";
import { appendActivity } from "../activity/log";
import { transitionJob } from "../jobs/service";
import { createAttestation } from "../attestations/service";

export async function runVerification(db: PrismaClient, submissionPk: string) {
  const submission = await db.submission.findUnique({
    where: { id: submissionPk },
    include: { evidence: { orderBy: { position: "asc" } } },
  });
  if (!submission) throw new ApiError("NOT_FOUND", "Submission not found");
  const job = await db.job.findUnique({ where: { id: submission.jobId } });
  if (!job) throw new ApiError("NOT_FOUND", "Job not found");

  await appendActivity(db, {
    jobId: job.id,
    type: "VERIFICATION_STARTED",
    actor: submission.worker,
  });

  const engineSubmission: EngineSubmission = {
    job_id: job.jobId,
    worker: submission.worker,
    submitted_at: submission.submittedAt.toISOString(),
    submission_id: submission.id,
    checklist_results: submission.checklistResults as any,
    evidence: submission.evidence.map(
      (e, i): EngineEvidence => ({
        id: `ev-${i + 1}`,
        requirement_id: e.requirementId,
        type: "PHOTO_EVIDENCE",
        storage_ref: e.storageRef,
        captured_at: e.capturedAt.toISOString(),
        content_hash: e.contentHash,
        metadata: (e.metadata ?? {}) as Record<string, unknown>,
      })
    ),
  };

  const result: VerificationResult = verifySubmission({
    requirements: job.requirements as unknown as Requirement[],
    submission: engineSubmission,
    expectedJobId: job.jobId,
    expectedWorker: job.worker,
  });

  const attempt = await db.verificationAttempt.create({
    data: {
      jobId: job.id,
      submissionId: submission.id,
      status: result.status as any,
      checks: result.checks as any,
      reason: result.reason,
    },
  });

  if (result.status === "VERIFIED") {
    await db.submission.update({
      where: { id: submission.id },
      data: { status: "VERIFIED" },
    });
    const attestation = await createAttestation(db, {
      job,
      submission: { ...submission, evidence: submission.evidence } as any,
      engineSubmission,
      result,
    });
    // Re-runs are safe: skip the transition if already at the target state.
    const fresh = await db.job.findUnique({ where: { id: job.id } });
    if (fresh && fresh.state !== "VERIFIED") {
      await transitionJob(db, job.id, "VERIFIED", {
        type: "VERIFIED",
        actor: job.verifier,
      });
    }
    logger.info("verification passed", {
      jobId: job.id,
      submissionId: submission.id,
      attestationId: attestation.id,
    });
    return { attempt, result, attestation };
  }

  await db.submission.update({
    where: { id: submission.id },
    data: { status: "REJECTED" },
  });
  const freshRejected = await db.job.findUnique({ where: { id: job.id } });
  if (freshRejected && freshRejected.state !== "REJECTED") {
    await transitionJob(db, job.id, "REJECTED", {
      type: "REJECTED",
      actor: job.verifier,
      metadata: { reason: result.reason },
    });
  }
  logger.info("verification rejected", {
    jobId: job.id,
    submissionId: submission.id,
    reason: result.reason,
  });
  return { attempt, result, attestation: null };
}

/**
 * Build a live VerifyAuthorization ticket for a VERIFIED result.
 * Throws for anything else — same gate the standalone service enforces.
 */
export interface Authorizable {
  status: "VERIFIED" | "REJECTED";
  job_id: string;
  submission_id: string;
  worker: string;
  checks: { requirement: string; passed: boolean; reason: string }[];
  verified_at: string;
  reason: string;
}

export function authorizeFor(
  jobId: string,
  worker: string,
  verifier: string,
  requirements: Requirement[],
  result: Authorizable
) {
  const svc = new VerificationService({
    jobId,
    worker,
    verifier,
    requirements,
  });
  return svc.authorizeOnChainVerify(result as VerificationResult);
}
