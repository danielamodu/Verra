/**
 * Settlement domain: VERIFIED attestation → verify_job → release_payment →
 * CONFIRMED, exactly once per job.
 *
 * Safety properties:
 * - jobId UNIQUE on Settlement: the database itself forbids double-pay rows.
 * - Existing CONFIRMED rows are returned without new transactions.
 * - Busy rows (PENDING/VERIFYING/RELEASING) return 409 — never a second tx.
 * - FAILED rows may retry; reconcile-then-act skips already-landed steps
 *   (verify_job on a VERIFIED job would revert, so it is skipped).
 * - Worker balance delta must equal the locked amount or the run FAILS
 *   without being marked confirmed.
 */
import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddress } from "@solana/spl-token";
import { ApiError, conflict } from "../../api/errors";
import { logger } from "../../logger";
import { verifyJobOnChain } from "../../../../verification/onchain";
import { verifyWorkerSignature, submissionCommitment } from "../../../../verification/attestation";
import type { Requirement } from "../../../../verification/schema";
import { appendActivity } from "../activity/log";
import { getJob } from "../jobs/service";
import { rebuildAttestation, verifyAttestationDigest } from "../attestations/service";
import { authorizeFor } from "../verification/service";
import {
  confirmSignature,
  escrowAtaFor,
  jobPdaFor,
  readChainJob,
  tokenBalance,
  type SolanaContext,
} from "../../infrastructure/solana/context";
import type { PrismaClient } from "@prisma/client";

export interface SettleInput {
  jobId: string; // on-chain job id
  attestationId?: string;
}

async function submissionShape(db: PrismaClient, submissionPk: string) {
  const sub = await db.submission.findUnique({
    where: { id: submissionPk },
    include: { evidence: { orderBy: { position: "asc" } } },
  });
  if (!sub) throw new ApiError("NOT_FOUND", "Submission not found");
  return sub;
}

export async function settleJob(
  db: PrismaClient,
  solana: SolanaContext,
  input: SettleInput
) {
  const job = await db.job.findFirst({ where: { jobId: input.jobId } });
  if (!job) throw new ApiError("NOT_FOUND", "Job not found");

  const attestation = input.attestationId
    ? await db.verificationAttestation.findUnique({ where: { id: input.attestationId } })
    : await db.verificationAttestation.findFirst({
        where: { jobId: job.id, result: "VERIFIED" },
        orderBy: { createdAt: "desc" },
      });
  if (!attestation) {
    throw new ApiError("UNPROCESSABLE", "No VERIFIED attestation for this job");
  }
  if (attestation.jobId !== job.id) {
    throw new ApiError("UNPROCESSABLE", "Attestation does not belong to this job");
  }
  if (attestation.result !== "VERIFIED" || attestation.worker !== job.worker) {
    throw new ApiError("UNPROCESSABLE", "Attestation is not valid for this job");
  }
  // Tamper check: the stored row must still digest to its pinned digest.
  if (!verifyAttestationDigest(attestation as any, job.jobId)) {
    throw new ApiError("UNPROCESSABLE", "Attestation digest mismatch — refusing settlement");
  }
  // Worker-signature re-validation when present.
  const sub = await submissionShape(db, attestation.submissionId);
  if (sub.workerSignature) {
    const commitment = submissionCommitment({
      job_id: job.jobId,
      submission_id: sub.id,
      worker: sub.worker,
      checklist_results: sub.checklistResults as any,
      evidence: sub.evidence.map((e, i) => ({
        id: `ev-${i + 1}`,
        requirement_id: e.requirementId,
        content_hash: e.contentHash,
      })) as any,
    });
    if (!verifyWorkerSignature(job.worker, commitment, sub.workerSignature)) {
      throw new ApiError("UNPROCESSABLE", "Worker signature does not verify");
    }
  }

  // Idempotency first: replays never touch the chain or the state gate.
  const existing = await db.settlement.findUnique({ where: { jobId: job.id } });
  if (existing) {
    if (existing.status === "CONFIRMED") {
      logger.info("settlement replayed (already confirmed)", {
        jobId: job.id,
        settlementId: existing.id,
      });
      return existing;
    }
    if (existing.status !== "FAILED") {
      throw conflict(`Settlement already ${existing.status} — retry later`);
    }
  }

  if (job.state !== "VERIFIED") {
    throw new ApiError(
      "UNPROCESSABLE",
      `Job is ${job.state} — only VERIFIED jobs settle`
    );
  }

  const settlement = existing
    ? await db.settlement.update({
        where: { id: existing.id },
        data: { status: "PENDING", error: null, verifyTx: null, releaseTx: null },
      })
    : await (async () => {
        try {
          return await db.settlement.create({
            data: {
              jobId: job.id,
              attestationId: attestation.id,
              status: "PENDING",
              amount: job.paymentAmount,
              recipient: job.worker,
            },
          });
        } catch (e: any) {
          if (e?.code === "P2002") {
            const raced = await db.settlement.findUnique({ where: { jobId: job.id } });
            if (raced?.status === "CONFIRMED") return raced;
            throw conflict("Settlement already in progress");
          }
          throw e;
        }
      })();

  const sid = { settlementId: settlement.id, jobId: job.id };
  const fail = async (step: string, err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    await db.settlement.update({
      where: { id: settlement.id },
      data: { status: "FAILED", error: `${step}: ${message}` },
    });
    await appendActivity(db, {
      jobId: job.id,
      type: "SETTLEMENT_FAILED",
      actor: job.verifier,
      metadata: { step, error: message },
    });
    logger.error("settlement failed", { ...sid, step, error: message });
    throw new ApiError("UPSTREAM_ERROR", `Settlement failed at ${step}: ${message}`);
  };

  try {
    await appendActivity(db, {
      jobId: job.id,
      type: "SETTLEMENT_STARTED",
      actor: job.verifier,
    });

    const jobPda = jobPdaFor(solana.programId, new PublicKey(job.business), job.jobId);
    const usdcMint = new PublicKey(job.usdcMint);
    const escrowAta = await escrowAtaFor(usdcMint, jobPda);
    const workerAta = await getAssociatedTokenAddress(usdcMint, new PublicKey(job.worker));

    // Three-gate authorization: only a VERIFIED result yields a ticket, and
    // the ticket is worthless without the live verifier key (checked inside).
    const rebuilt = rebuildAttestation(attestation as any, job.jobId);
    const ticket = authorizeFor(
      job.jobId,
      job.worker,
      job.verifier,
      job.requirements as unknown as Requirement[],
      {
        status: rebuilt.result,
        job_id: rebuilt.job_id,
        submission_id: rebuilt.submission_id,
        worker: rebuilt.worker,
        checks: rebuilt.checks,
        verified_at: rebuilt.verified_at,
        reason: rebuilt.reason,
      }
    );
    void ticket;

    // Reconcile-then-act: the chain starts SUBMITTED (worker submitted);
    // this flow sends verify_job, then release_payment. A VERIFIED chain
    // means a previous attempt already landed verify — never re-send it
    // (it would revert), just proceed to release.
    const chain = await readChainJob(solana.program, jobPda);
    if (!chain.exists) throw new Error("Job account missing on-chain");
    if (chain.state === "SETTLED") {
      // Funds moved without a CONFIRMED row (crash between confirm and
      // persist). Never guess and never re-release: surface for operator
      // reconciliation via the escrow account on explorer.
      throw new Error("On-chain job already SETTLED without a confirmed settlement row");
    }
    if (chain.state !== "SUBMITTED" && chain.state !== "VERIFIED") {
      throw new Error(`On-chain job is ${chain.state}, expected SUBMITTED`);
    }

    await db.settlement.update({ where: { id: settlement.id }, data: { status: "VERIFYING" } });
    let verifyTx: string | null = settlement.verifyTx;
    if (chain.state === "SUBMITTED") {
      verifyTx = await verifyJobOnChain(solana.program, ticket as any, jobPda, solana.verifierKeypair);
      await confirmSignature(solana.connection, verifyTx);
      await db.settlement.update({
        where: { id: settlement.id },
        data: { status: "RELEASING", verifyTx },
      });
      await db.verificationAttestation.update({
        where: { id: attestation.id },
        data: { verifySignature: verifyTx },
      });
      logger.info("verify_job confirmed", { ...sid, txSignature: verifyTx });
    } else {
      logger.info("verify already on-chain, skipping re-send", { ...sid });
    }

    const workerBefore = await tokenBalance(solana.connection, workerAta);
    const releaseSig: string = await solana.program.methods
      .releasePayment()
      .accounts({
        settlementAuthority: solana.verifierKeypair.publicKey,
        job: jobPda,
        escrowAta,
        workerAta,
        tokenProgram: (await import("@solana/spl-token")).TOKEN_PROGRAM_ID,
      })
      .signers([solana.verifierKeypair])
      .rpc();
    await confirmSignature(solana.connection, releaseSig);
    const workerAfter = await tokenBalance(solana.connection, workerAta);
    const amount = Number(job.paymentAmount);
    if (workerAfter - workerBefore !== amount) {
      throw new Error(
        `Transfer mismatch: worker delta ${workerAfter - workerBefore}, expected ${amount}`
      );
    }

    await db.job.update({ where: { id: job.id }, data: { state: "SETTLED" } });
    const confirmed = await db.settlement.update({
      where: { id: settlement.id },
      data: {
        status: "CONFIRMED",
        releaseTx: releaseSig,
        confirmedAt: new Date(),
      },
    });
    await appendActivity(db, {
      jobId: job.id,
      type: "PAYMENT_RELEASED",
      actor: job.verifier,
      txSignature: releaseSig,
      metadata: { amount, recipient: job.worker, verifyTx },
    });
    logger.info("settlement confirmed", {
      ...sid,
      txSignature: releaseSig,
      amount,
    });
    return confirmed;
  } catch (e: any) {
    if (e instanceof ApiError) throw e;
    await fail("settle", e);
    throw new ApiError("UPSTREAM_ERROR", "Settlement failed");
  }
}
