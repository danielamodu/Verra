/**
 * Application-client boundary.
 *
 * mobile UI → ProofpayBackend → (demo in-memory | Solana devnet program).
 * The UI only depends on this interface — swapping backends changes no
 * screen code. Settlement receipts ALWAYS say whether they are real:
 * `real: true` carries a confirmed on-chain signature; anything else must
 * be rendered as NOT settled.
 */
import type {
  Evidence,
  Requirement,
  Submission,
  VerificationResult,
} from "../../../verification/schema";

export type ChainState =
  | "CREATED"
  | "FUNDED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "VERIFIED"
  | "REJECTED"
  | "SETTLED";

export interface ActivityEvent {
  key: string;
  label: string;
  at: string;
}

export interface ProofpayJob {
  id: string;
  title: string;
  description: string;
  paymentBaseUnits: number;
  business: string;
  worker: string;
  chainState: ChainState;
  requirements: Requirement[];
  submissionId?: string;
  verification?: VerificationResult;
  settlement?: SettlementReceipt;
  activity: ActivityEvent[];
}

export interface SettlementReceipt {
  /** True ONLY for a confirmed on-chain release_payment transaction. */
  real: boolean;
  signature?: string;
  /** verify_job signature (present on real receipts). */
  verifySignature?: string;
  amountBaseUnits: number;
  worker: string;
  note: string;
}

export interface CreateJobInput {
  title: string;
  description: string;
  paymentBaseUnits: number;
  worker: string;
  requirements: Requirement[];
  /** Required by the on-chain program (SolanaBackend); demo backend ignores it. */
  verifier?: string;
}

/** Draft evidence captured on-device (photo bytes hashed locally). */
export interface DraftEvidence {
  requirementId: string;
  uri: string;
  contentHash: string;
  mimeType: string;
  capturedAt: string;
}

/**
 * Worker-signed submission envelope. Extra fields ride on top of the Phase 2
 * Submission — the engine validates known fields and ignores the rest, so
 * determinism is unaffected. The attestation layer consumes these fields.
 */
export interface SignedSubmission extends Submission {
  device_id?: string;
  worker_signature?: string;
}

export class NotWiredError extends Error {
  constructor(method: string) {
    super(
      `${method} is not wired to Solana yet. See docs/mobile.md ` +
        `(“Wiring the real backend”) for the exact steps.`
    );
    this.name = "NotWiredError";
  }
}

export interface ProofpayBackend {
  readonly backendName: string;
  /** True when receipts from this backend represent on-chain settlement. */
  readonly settlesOnChain: boolean;
  listJobs(): Promise<ProofpayJob[]>;
  getJob(id: string): Promise<ProofpayJob>;
  getSubmission(id: string): Promise<Submission | undefined>;
  createJob(input: CreateJobInput, business: string): Promise<ProofpayJob>;
  acceptJob(id: string, worker: string): Promise<ProofpayJob>;
  submitCompletion(id: string, draft: {
    submissionId: string;
    completedChecklists: string[];
    evidence: DraftEvidence[];
    deviceId?: string;
    workerSignature?: string;
  }): Promise<VerificationResult>;
  getVerification(id: string): Promise<VerificationResult | undefined>;
  releasePayment(id: string): Promise<SettlementReceipt>;
  /** Backend-operated settlement (verifier key lives server-side). Optional. */
  requestSettlement?(id: string): Promise<SettlementReceipt>;
}

export function submissionFromDraft(
  job: ProofpayJob,
  worker: string,
  submissionId: string,
  completedChecklists: string[],
  drafts: DraftEvidence[],
  submittedAt: string,
  deviceId?: string
): SignedSubmission {
  const evidence: Evidence[] = drafts.map((d, i) => ({
    id: `ev-${i + 1}`,
    requirement_id: d.requirementId,
    type: "PHOTO_EVIDENCE",
    storage_ref: `local:${d.uri}`,
    captured_at: d.capturedAt,
    content_hash: d.contentHash,
    metadata: { mimeType: d.mimeType, ...(deviceId ? { deviceId } : {}) },
  }));
  const submission: SignedSubmission = {
    job_id: job.id,
    worker,
    submitted_at: submittedAt,
    submission_id: submissionId,
    checklist_results: job.requirements
      .filter((r) => r.type === "CHECKLIST")
      .map((r) => ({
        requirement_id: r.id,
        completed: completedChecklists.includes(r.id),
      })),
    evidence,
  };
  if (deviceId) submission.device_id = deviceId;
  return submission;
}
