/**
 * ProofPay Verification Engine — typed schemas (V1).
 *
 * Only two requirement types exist: CHECKLIST and PHOTO_EVIDENCE.
 * Nothing here is probabilistic. The engine (engine.ts) evaluates these
 * schemas with fixed deterministic rules.
 */

/** The only requirement types supported in V1. */
export type RequirementType = "CHECKLIST" | "PHOTO_EVIDENCE";

/** Verification verdict. No other statuses exist. */
export type VerificationStatus = "VERIFIED" | "REJECTED";

/** Configuration for a CHECKLIST requirement. */
export interface ChecklistConfig {
  /** Every listed item must be completed for the requirement to pass. */
  items: { id: string; label: string }[];
}

/** Configuration for a PHOTO_EVIDENCE requirement. */
export interface PhotoEvidenceConfig {
  /** Minimum number of qualifying evidence items. Must be >= 1. */
  minPhotos: number;
}

export interface Requirement {
  id: string;
  type: RequirementType;
  label: string;
  /** Required requirements must pass; optional ones are recorded but never fail. */
  required: boolean;
  configuration: ChecklistConfig | PhotoEvidenceConfig;
}

export interface ChecklistResult {
  requirement_id: string;
  completed: boolean;
}

export interface Evidence {
  id: string;
  requirement_id: string;
  type: RequirementType;
  /** Opaque pointer to off-chain storage (URI, path, or content-addressed id). */
  storage_ref: string;
  /** ISO-8601 timestamp of capture. Must be <= submission.submitted_at. */
  captured_at: string;
  /** Lowercase hex SHA-256 of the evidence bytes (see evidence.ts). */
  content_hash: string;
  metadata: Record<string, unknown>;
}

export interface Submission {
  /** Decimal string of the on-chain u64 job id (exact, no float precision loss). */
  job_id: string;
  /** Base58 pubkey of the submitting worker. */
  worker: string;
  /** ISO-8601 timestamp of submission. */
  submitted_at: string;
  submission_id: string;
  checklist_results: ChecklistResult[];
  evidence: Evidence[];
}

/** One per requirement, in requirements order. */
export interface VerificationCheck {
  requirement: string;
  passed: boolean;
  reason: string;
}

export interface VerificationResult {
  job_id: string;
  submission_id: string;
  worker: string;
  status: VerificationStatus;
  checks: VerificationCheck[];
  /** ISO-8601 timestamp of evaluation (injected clock; see engine.ts). */
  verified_at: string;
  reason: string;
}

/**
 * Authorization ticket: the ONLY bridge from an engine result to the chain.
 * Produced server-side, and only for VERIFIED results. The actual
 * `verify_job` transaction must still be signed by the verifier keypair,
 * which is held by the backend/operator — never by the worker client.
 */
export interface VerifyAuthorization {
  job_id: string;
  submission_id: string;
  worker: string;
  verifier: string;
  issued_at: string;
}
