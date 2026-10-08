/**
 * Minimal submission/result persistence boundary.
 *
 * In-memory by default (suitable for tests and the V1 service). A production
 * deployment swaps this for durable storage behind the same interface —
 * the engine and service layers do not change.
 */
import type { Submission, VerificationResult } from "./schema";

export interface SubmissionStore {
  /** Persist a received submission. Throws on duplicate submission_id. */
  save(submission: Submission): void;
  get(submissionId: string): Submission | undefined;
  listByJob(jobId: string): Submission[];
  saveResult(result: VerificationResult): void;
  getResult(submissionId: string): VerificationResult | undefined;
}

export class InMemorySubmissionStore implements SubmissionStore {
  private submissions = new Map<string, Submission>();
  private results = new Map<string, VerificationResult>();

  save(submission: Submission): void {
    if (this.submissions.has(submission.submission_id)) {
      throw new Error(
        `duplicate submission_id '${submission.submission_id}' (resubmissions must use a new submission_id)`
      );
    }
    this.submissions.set(submission.submission_id, submission);
  }

  get(submissionId: string): Submission | undefined {
    return this.submissions.get(submissionId);
  }

  listByJob(jobId: string): Submission[] {
    return [...this.submissions.values()].filter((s) => s.job_id === jobId);
  }

  saveResult(result: VerificationResult): void {
    this.results.set(result.submission_id, result);
  }

  getResult(submissionId: string): VerificationResult | undefined {
    return this.results.get(submissionId);
  }
}
