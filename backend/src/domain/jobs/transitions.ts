/**
 * Backend job state guard. Mirrors the on-chain machine; the program stays
 * the final authority — this guard rejects invalid transitions BEFORE any
 * chain action is attempted.
 */
export type JobState =
  | "CREATED"
  | "FUNDED"
  | "IN_PROGRESS"
  | "SUBMITTED"
  | "VERIFIED"
  | "REJECTED"
  | "SETTLED";

const ALLOWED: Record<JobState, JobState[]> = {
  CREATED: ["FUNDED"],
  FUNDED: ["IN_PROGRESS"],
  IN_PROGRESS: ["SUBMITTED"],
  SUBMITTED: ["VERIFIED", "REJECTED"],
  VERIFIED: ["SETTLED"],
  // Resubmission loop: new evidence re-queues a rejected job for review.
  REJECTED: ["SUBMITTED"],
  SETTLED: [],
};

export function canTransition(from: JobState, to: JobState): boolean {
  return (ALLOWED[from] ?? []).includes(to);
}

export function assertTransition(from: JobState, to: JobState): void {
  if (!canTransition(from, to)) {
    throw new Error(`Invalid job transition ${from} → ${to}`);
  }
}
