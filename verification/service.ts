/**
 * Verification service — the API boundary between worker clients and the chain.
 *
 * Flow:
 *   worker submission → persist → engine → VerificationResult →
 *   VERIFIED ? VerifyAuthorization ticket (server-side only) : no ticket.
 *
 * Authorization model (explicit):
 *   - The worker client can only SUBMIT evidence. It can never mint a
 *     "verified: true" outcome: results are computed by the engine from the
 *     stored submission, and only a VERIFIED result yields an authorization
 *     ticket.
 *   - The ticket alone moves no funds. Settlement still requires the
 *     authorized verifier keypair (held by the backend/operator, never the
 *     worker) to sign the on-chain `verify_job` transaction (see onchain.ts).
 *   - A REJECTED result yields no ticket; the on-chain job stays unpaid and
 *     the worker may resubmit with a new submission_id.
 */
import { verifySubmission } from "./engine";
import { InMemorySubmissionStore, type SubmissionStore } from "./store";
import type {
  Requirement,
  Submission,
  VerificationResult,
  VerifyAuthorization,
} from "./schema";

export interface ServiceConfig {
  /** On-chain job id this service instance is bound to (decimal u64 string). */
  jobId: string;
  /** Worker pubkey (base58) assigned to the job on-chain. */
  worker: string;
  /** Verifier pubkey (base58) authorized to sign `verify_job` on-chain. */
  verifier: string;
  requirements: Requirement[];
  store?: SubmissionStore;
  /** Injected clock for deterministic `verified_at` (defaults to Date.now). */
  clock?: () => number;
}

export class VerificationService {
  private store: SubmissionStore;
  private clock: () => number;

  constructor(
    private readonly config: ServiceConfig
  ) {
    this.store = config.store ?? new InMemorySubmissionStore();
    this.clock = config.clock ?? Date.now;
  }

  get jobId(): string {
    return this.config.jobId;
  }

  /**
   * Accept an untrusted worker payload, persist it, evaluate it.
   * Always returns a VerificationResult (VERIFIED or REJECTED) — malformed
   * input produces REJECTED, never an exception, except for duplicate
   * submission_ids (a client retry/resubmission protocol error).
   */
  submit(payload: unknown): VerificationResult {
    // Persist first so every received payload is auditable, then evaluate.
    // Structural validation happens inside the engine; for persistence we
    // require at least a shape with a submission_id.
    const p = payload as Partial<Submission>;
    if (
      payload === null ||
      typeof payload !== "object" ||
      typeof p.submission_id !== "string" ||
      p.submission_id.length === 0
    ) {
      // Not even persistable — still a deterministic REJECTED.
      return verifySubmission({
        requirements: this.config.requirements,
        submission: payload,
        expectedJobId: this.config.jobId,
        expectedWorker: this.config.worker,
        now: this.clock(),
      });
    }
    this.store.save(payload as Submission);
    const result = verifySubmission({
      requirements: this.config.requirements,
      submission: payload,
      expectedJobId: this.config.jobId,
      expectedWorker: this.config.worker,
      now: this.clock(),
    });
    this.store.saveResult(result);
    return result;
  }

  /**
   * Exchange a VERIFIED result for an on-chain authorization ticket.
   * Throws for REJECTED results: there is no code path from a failed
   * verification to a `verify_job` signature.
   */
  authorizeOnChainVerify(result: VerificationResult): VerifyAuthorization {
    if (result.status !== "VERIFIED") {
      throw new Error(
        `cannot authorize on-chain verification: submission '${result.submission_id}' is ${result.status} (${result.reason})`
      );
    }
    if (result.job_id !== this.config.jobId || result.worker !== this.config.worker) {
      throw new Error("cannot authorize: result does not match this service's job/worker binding");
    }
    return {
      job_id: result.job_id,
      submission_id: result.submission_id,
      worker: result.worker,
      verifier: this.config.verifier,
      issued_at: new Date(this.clock()).toISOString(),
    };
  }

  getSubmission(submissionId: string): Submission | undefined {
    return this.store.get(submissionId);
  }

  getResult(submissionId: string): VerificationResult | undefined {
    return this.store.getResult(submissionId);
  }

  listSubmissions(): Submission[] {
    return this.store.listByJob(this.config.jobId);
  }
}
