/**
 * Local demo backend — honest UX preview, zero chain claims.
 *
 * Runs the REAL shared verification engine (imported, not duplicated) so
 * demo verdicts follow the exact production rules. It NEVER produces a
 * real settlement receipt: releasePayment keeps chainState at VERIFIED and
 * returns { real: false }. The Settlement screen renders the success layout
 * only for real receipts.
 */
import { VerificationService } from "../../../verification/service";
import { submissionCommitment, verifyWorkerSignature } from "../../../verification/attestation";
import type { VerificationResult } from "../../../verification/schema";
import { storeInspectionRequirements } from "../../../verification/example-job";
import {
  submissionFromDraft,
  type CreateJobInput,
  type ProofpayBackend,
  type ProofpayJob,
  type SettlementReceipt,
  type SignedSubmission,
} from "./types";

function now(): string {
  return new Date().toISOString();
}

export class LocalDemoBackend implements ProofpayBackend {
  readonly backendName = "LocalDemo (not on-chain)";
  readonly settlesOnChain = false;
  private jobs = new Map<string, ProofpayJob>();
  private submissions = new Map<string, SignedSubmission>();
  private counter = 0;

  constructor(seedDemo = true) {
    if (seedDemo) this.seed();
  }

  private seed() {
    // Demo job mirrors the Verra brief: 10-item checklist + 3 photos, $150.
    const base = storeInspectionRequirements();
    const requirements = base.map((r) =>
      r.type === "PHOTO_EVIDENCE"
        ? { ...r, configuration: { minPhotos: 3 } }
        : r
    );
    const job: ProofpayJob = {
      id: "demo-150",
      title: "Inspect 10 stores",
      description: "Visit all 10 stores, complete the checklist, submit 3 photos.",
      paymentBaseUnits: 150_000_000,
      business: "DemoBizWallet1111111111111111111111111111111",
      worker: "DemoWorkerWallet11111111111111111111111111111",
      chainState: "FUNDED",
      requirements,
      activity: [
        { key: "created", label: "Job created", at: now() },
        { key: "funded", label: "Funds locked (demo)", at: now() },
      ],
    };
    this.jobs.set(job.id, job);
  }

  async listJobs(): Promise<ProofpayJob[]> {
    return [...this.jobs.values()];
  }

  async getJob(id: string): Promise<ProofpayJob> {
    const job = this.jobs.get(id);
    if (!job) throw new Error(`Job ${id} not found`);
    return job;
  }

  async getSubmission(id: string): Promise<SignedSubmission | undefined> {
    const job = await this.getJob(id);
    if (!job.submissionId) return undefined;
    return this.submissions.get(job.submissionId);
  }

  async createJob(input: CreateJobInput, business: string): Promise<ProofpayJob> {
    this.counter += 1;
    const job: ProofpayJob = {
      id: `job-${Date.now()}-${this.counter}`,
      title: input.title,
      description: input.description,
      paymentBaseUnits: input.paymentBaseUnits,
      business,
      worker: input.worker,
      chainState: "FUNDED",
      requirements: input.requirements,
      activity: [
        { key: "created", label: "Job created", at: now() },
        { key: "funded", label: "Funds locked (demo)", at: now() },
      ],
    };
    this.jobs.set(job.id, job);
    return job;
  }

  async acceptJob(id: string, worker: string): Promise<ProofpayJob> {
    const job = await this.getJob(id);
    if (job.chainState !== "FUNDED") throw new Error(`Cannot accept job in state ${job.chainState}`);
    job.worker = worker;
    job.chainState = "IN_PROGRESS";
    job.activity.push({ key: "accepted", label: "Worker accepted", at: now() });
    return job;
  }

  async submitCompletion(
    id: string,
    draft: { submissionId: string; completedChecklists: string[]; evidence: import("./types").DraftEvidence[]; deviceId?: string; workerSignature?: string }
  ): Promise<VerificationResult> {
    const job = await this.getJob(id);
    if (job.chainState !== "IN_PROGRESS") {
      throw new Error(`Cannot submit job in state ${job.chainState}`);
    }
    const svc = new VerificationService({
      jobId: job.id,
      worker: job.worker,
      verifier: "demo-verifier",
      requirements: job.requirements,
    });
    const submission = submissionFromDraft(
      job,
      job.worker,
      draft.submissionId,
      draft.completedChecklists,
      draft.evidence,
      now(),
      draft.deviceId
    );
    if (draft.workerSignature) {
      submission.worker_signature = draft.workerSignature;
      // A present signature must verify against the recorded worker —
      // otherwise the submission is rejected as inauthentic.
      const commitment = submissionCommitment(submission);
      if (!verifyWorkerSignature(job.worker, commitment, draft.workerSignature)) {
        throw new Error("Invalid worker signature for this submission.");
      }
    }
    const result = svc.submit(submission);
    this.submissions.set(submission.submission_id, submission);
    job.submissionId = submission.submission_id;
    job.verification = result;
    job.chainState = "SUBMITTED";
    job.activity.push({ key: "submitted", label: "Evidence submitted", at: now() });
    if (result.status === "VERIFIED") {
      job.chainState = "VERIFIED";
      job.activity.push({ key: "verified", label: "Verification passed (demo engine)", at: now() });
    } else {
      job.chainState = "REJECTED";
      job.activity.push({ key: "rejected", label: `Verification failed: ${result.reason}`, at: now() });
    }
    return result;
  }

  async getVerification(id: string): Promise<VerificationResult | undefined> {
    return (await this.getJob(id)).verification;
  }

  async getActivity(id: string): Promise<{ key: string; label: string; at: string }[]> {
    const job = await this.getJob(id);
    return job.activity.map((a) => ({ key: a.key, label: a.label, at: a.at }));
  }

  async releasePayment(id: string): Promise<SettlementReceipt> {
    const job = await this.getJob(id);
    if (job.chainState !== "VERIFIED") {
      throw new Error(`Only VERIFIED jobs can settle (job is ${job.chainState})`);
    }
    // Honest demo: state stays VERIFIED, receipt is explicitly not real.
    const receipt: SettlementReceipt = {
      real: false,
      amountBaseUnits: job.paymentBaseUnits,
      worker: job.worker,
      note: "Demo mode — connect the Solana backend to release $150 USDC on-chain.",
    };
    job.settlement = receipt;
    job.activity.push({ key: "release-requested", label: "Release requested (demo — not on-chain)", at: now() });
    return receipt;
  }
}
