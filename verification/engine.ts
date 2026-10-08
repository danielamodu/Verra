/**
 * Deterministic verification engine.
 *
 * Rules (fixed, no AI, no randomness, no network):
 *   - CHECKLIST passes only if every REQUIRED checklist requirement has a
 *     result with completed === true.
 *   - PHOTO_EVIDENCE passes only if every REQUIRED photo requirement has at
 *     least `minPhotos` qualifying evidence items.
 *   - Missing evidence = failure. Incomplete checklist = failure.
 *   - Wrong worker = failure. Wrong job = failure.
 *   - Malformed submission = failure (fail closed on any structural defect).
 *
 * Evaluation order is fixed: structural validation → identity (job, worker)
 * → per-requirement checks in requirements order. The same input (plus the
 * same injected `now`) always yields a byte-identical result.
 */
import { isWellFormedHash } from "./evidence";
import type {
  Evidence,
  Requirement,
  Submission,
  VerificationCheck,
  VerificationResult,
} from "./schema";

export interface VerifyInput {
  requirements: Requirement[];
  /** Untrusted client payload — validated at runtime, never trusted. */
  submission: unknown;
  /** Expected on-chain job id (decimal string of the u64). */
  expectedJobId: string;
  /** Expected worker (base58 pubkey recorded on-chain at job creation). */
  expectedWorker: string;
  /** Injected clock (ms epoch) for `verified_at`. Defaults to Date.now(). */
  now?: number;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.length > 0;
}

function parseDate(v: unknown): number | null {
  if (typeof v !== "string") return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : t;
}

interface Normalized {
  submission: Submission;
  submittedAtMs: number;
}

/** Structural validation. Returns errors in fixed order, or normalized data. */
function validateStructure(submission: unknown): { errors: string[]; data?: Normalized } {
  const errors: string[] = [];
  if (!isRecord(submission)) {
    return { errors: ["malformed submission: must be an object"] };
  }
  const s = submission as Record<string, unknown>;

  if (!isNonEmptyString(s.job_id)) errors.push("malformed submission: job_id must be a non-empty string");
  if (!isNonEmptyString(s.worker)) errors.push("malformed submission: worker must be a non-empty string");
  if (!isNonEmptyString(s.submission_id))
    errors.push("malformed submission: submission_id must be a non-empty string");

  const submittedAtMs = parseDate(s.submitted_at);
  if (submittedAtMs === null)
    errors.push("malformed submission: submitted_at must be a valid ISO-8601 timestamp");

  if (!Array.isArray(s.checklist_results))
    errors.push("malformed submission: checklist_results must be an array");
  if (!Array.isArray(s.evidence)) errors.push("malformed submission: evidence must be an array");

  if (errors.length > 0) return { errors };

  const results = s.checklist_results as unknown[];
  const evidence = s.evidence as unknown[];

  const seenResults = new Set<string>();
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (!isRecord(r) || !isNonEmptyString(r.requirement_id) || typeof r.completed !== "boolean") {
      errors.push(
        `malformed submission: checklist_results[${i}] must be { requirement_id: string, completed: boolean }`
      );
      continue;
    }
    if (seenResults.has(r.requirement_id)) {
      errors.push(`malformed submission: duplicate checklist result for '${r.requirement_id}'`);
    }
    seenResults.add(r.requirement_id);
  }

  const seenEvidence = new Set<string>();
  for (let i = 0; i < evidence.length; i++) {
    const e = evidence[i];
    if (
      !isRecord(e) ||
      !isNonEmptyString(e.id) ||
      !isNonEmptyString(e.requirement_id) ||
      (e.type !== "CHECKLIST" && e.type !== "PHOTO_EVIDENCE") ||
      !isNonEmptyString(e.storage_ref) ||
      !isRecord(e.metadata)
    ) {
      errors.push(
        `malformed submission: evidence[${i}] must have id, requirement_id, type, storage_ref (non-empty strings) and metadata (object)`
      );
      continue;
    }
    if (seenEvidence.has(e.id)) {
      errors.push(`malformed submission: duplicate evidence id '${e.id}'`);
      continue;
    }
    seenEvidence.add(e.id);
    if (!isWellFormedHash(e.content_hash)) {
      errors.push(`malformed submission: evidence '${e.id}' has invalid content_hash (must be lowercase hex SHA-256)`);
    }
    const capturedMs = parseDate(e.captured_at);
    if (capturedMs === null) {
      errors.push(`malformed submission: evidence '${e.id}' has invalid captured_at timestamp`);
    } else if (submittedAtMs !== null && capturedMs > submittedAtMs) {
      errors.push(`malformed submission: evidence '${e.id}' captured_at is after submitted_at`);
    }
  }

  if (errors.length > 0) return { errors };
  return {
    errors,
    data: {
      submission: s as unknown as Submission,
      submittedAtMs: submittedAtMs as number,
    },
  };
}

/**
 * Evaluate one submission. Pure: no I/O, no randomness.
 * Same input + same `now` => identical output.
 */
export function verifySubmission(input: VerifyInput): VerificationResult {
  const now = input.now ?? Date.now();
  const verifiedAt = new Date(now).toISOString();
  const failAll = (reason: string): VerificationResult => ({
    job_id: input.expectedJobId,
    submission_id:
      isRecord(input.submission) && typeof input.submission.submission_id === "string"
        ? (input.submission.submission_id as string)
        : "",
    worker:
      isRecord(input.submission) && typeof input.submission.worker === "string"
        ? (input.submission.worker as string)
        : "",
    status: "REJECTED",
    checks: input.requirements.map((r) => ({
      requirement: r.id,
      passed: false,
      reason,
    })),
    verified_at: verifiedAt,
    reason,
  });

  // 1. Structural validation (fail closed).
  const { errors, data } = validateStructure(input.submission);
  if (!data) return failAll(errors[0] ?? "malformed submission");

  // 1b. References must point at known requirements of matching type.
  const byId = new Map(input.requirements.map((r) => [r.id, r] as const));
  for (const r of data.submission.checklist_results) {
    const req = byId.get(r.requirement_id);
    if (!req || req.type !== "CHECKLIST") {
      return failAll(
        `malformed submission: checklist result references unknown requirement '${r.requirement_id}'`
      );
    }
  }
  for (const e of data.submission.evidence) {
    const req = byId.get(e.requirement_id);
    if (!req || req.type !== "PHOTO_EVIDENCE" || e.type !== "PHOTO_EVIDENCE") {
      return failAll(
        `malformed submission: evidence '${(e as Evidence).id}' references unknown requirement '${(e as Evidence).requirement_id}'`
      );
    }
  }

  // 2. Identity: wrong job / wrong worker = failure.
  if (data.submission.job_id !== input.expectedJobId) {
    return failAll(
      `wrong job: submission is for job '${data.submission.job_id}', expected '${input.expectedJobId}'`
    );
  }
  if (data.submission.worker !== input.expectedWorker) {
    return failAll(
      `wrong worker: submission is from '${data.submission.worker}', expected '${input.expectedWorker}'`
    );
  }

  // 3. Per-requirement checks, in requirements order.
  const resultsByReq = new Map(
    data.submission.checklist_results.map((r) => [r.requirement_id, r] as const)
  );
  const evidenceByReq = new Map<string, Evidence[]>();
  for (const e of data.submission.evidence) {
    const list = evidenceByReq.get(e.requirement_id) ?? [];
    list.push(e);
    evidenceByReq.set(e.requirement_id, list);
  }

  const checks: VerificationCheck[] = input.requirements.map((req) => {
    if (req.type === "CHECKLIST") {
      const res = resultsByReq.get(req.id);
      if (!req.required) {
        return {
          requirement: req.id,
          passed: true,
          reason: res
            ? `optional checklist recorded (completed=${res.completed}); not required`
            : "optional checklist skipped; not required",
        };
      }
      if (!res) {
        return { requirement: req.id, passed: false, reason: "incomplete checklist: missing result" };
      }
      if (res.completed !== true) {
        return { requirement: req.id, passed: false, reason: "incomplete checklist: not completed" };
      }
      return { requirement: req.id, passed: true, reason: "checklist completed" };
    }

    // PHOTO_EVIDENCE
    const minPhotos =
      req.configuration && typeof (req.configuration as { minPhotos?: unknown }).minPhotos === "number"
        ? (req.configuration as { minPhotos: number }).minPhotos
        : 1;
    const items = evidenceByReq.get(req.id) ?? [];
    if (!req.required && items.length === 0) {
      return { requirement: req.id, passed: true, reason: "optional evidence skipped; not required" };
    }
    if (items.length < minPhotos) {
      return {
        requirement: req.id,
        passed: false,
        reason: `missing evidence: found ${items.length} photo(s), require at least ${minPhotos}`,
      };
    }
    return {
      requirement: req.id,
      passed: true,
      reason: `${items.length} photo(s) present (required ${minPhotos})`,
    };
  });

  const failed = checks.filter((c) => !c.passed);
  if (failed.length > 0) {
    return {
      job_id: input.expectedJobId,
      submission_id: data.submission.submission_id,
      worker: data.submission.worker,
      status: "REJECTED",
      checks,
      verified_at: verifiedAt,
      reason: failed[0].reason,
    };
  }
  return {
    job_id: input.expectedJobId,
    submission_id: data.submission.submission_id,
    worker: data.submission.worker,
    status: "VERIFIED",
    checks,
    verified_at: verifiedAt,
    reason: `all ${checks.length} requirement check(s) passed`,
  };
}
