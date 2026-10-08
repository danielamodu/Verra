/** Attestation persistence: first-class, digest-pinned, tamper-evident. */
import type { PrismaClient } from "@prisma/client";
import {
  attachWorkerSignature,
  attestationDigest,
  buildAttestation,
  type Attestation,
} from "../../../../verification/attestation";
import type {
  Submission as EngineSubmission,
  VerificationResult,
} from "../../../../verification/schema";
import { logger } from "../../logger";

export interface AttestationBuildInput {
  job: { id: string; jobId: string; worker: string; verifier: string };
  submission: { id: string; workerSignature: string | null; evidence: { metadata: unknown }[] };
  engineSubmission: EngineSubmission;
  result: VerificationResult;
}

function deviceIdFrom(submission: { evidence: { metadata: unknown }[] }): string | undefined {
  for (const e of submission.evidence) {
    const m = e.metadata as Record<string, unknown> | null;
    if (m && typeof m.deviceId === "string" && m.deviceId) return m.deviceId;
  }
  return undefined;
}

export async function createAttestation(
  db: PrismaClient,
  input: AttestationBuildInput
) {
  if (input.result.status !== "VERIFIED") {
    throw new Error("Attestations are only created for VERIFIED results");
  }
  const existing = await db.verificationAttestation.findUnique({
    where: { submissionId: input.submission.id },
  });
  if (existing) return existing;

  let att: Attestation = buildAttestation({
    result: input.result,
    submission: input.engineSubmission,
    verifier: input.job.verifier,
    deviceId: deviceIdFrom(input.submission),
  });
  if (input.submission.workerSignature) {
    att = attachWorkerSignature(att, input.submission.workerSignature);
  }
  const digest = attestationDigest(att);

  const row = await db.verificationAttestation.create({
    data: {
      jobId: input.job.id,
      submissionId: input.submission.id,
      worker: att.worker,
      verifier: att.verifier,
      requirements: input.result.checks as any,
      evidenceCommitments: att.evidence_hashes as any,
      result: att.result,
      canonicalDigest: digest,
      workerSignature: att.worker_signature,
      deviceId: att.device_id,
      checks: att.checks as any,
      reason: att.reason,
      verifiedAt: new Date(att.verified_at),
    },
  });
  logger.info("attestation created", {
    jobId: input.job.id,
    submissionId: input.submission.id,
    attestationId: row.id,
  });
  return row;
}

/**
 * Rebuild the attestation object from its row and recompute the digest.
 * Any tampering with the stored row is detected here, before settlement.
 * NOTE: the digest's job_id is the ON-CHAIN job id (result.job_id), while
 * the row's jobId column is the database FK — pass the on-chain id.
 */
export function rebuildAttestation(
  row: {
    submissionId: string;
    worker: string;
    verifier: string;
    deviceId: string | null;
    workerSignature: string | null;
    verifySignature: string | null;
    checks: unknown;
    evidenceCommitments: unknown;
    result: string;
    reason: string;
    verifiedAt: Date;
  },
  onChainJobId: string
): Attestation {
  return {
    attestation_version: 1,
    job_id: onChainJobId,
    submission_id: row.submissionId,
    worker: row.worker,
    device_id: row.deviceId ?? undefined,
    worker_signature: row.workerSignature ?? undefined,
    checks: row.checks as Attestation["checks"],
    evidence_hashes: row.evidenceCommitments as Attestation["evidence_hashes"],
    result: row.result as "VERIFIED",
    reason: row.reason,
    verified_at: row.verifiedAt.toISOString(),
    verifier: row.verifier,
    verify_signature: row.verifySignature ?? undefined,
  };
}

export function verifyAttestationDigest(
  row: Parameters<typeof rebuildAttestation>[0] & { canonicalDigest: string },
  onChainJobId: string
): boolean {
  return attestationDigest(rebuildAttestation(row, onChainJobId)) === row.canonicalDigest;
}
