/** Job lifecycle persistence + transition guard + chain reconciliation. */
import type { PrismaClient } from "@prisma/client";
import { ApiError, conflict, notFound } from "../../api/errors";
import { logger } from "../../logger";
import { appendActivity } from "../activity/log";
import { assertTransition, type JobState } from "./transitions";

export interface RegisterJobInput {
  jobId: string;
  jobPda: string;
  business: string;
  worker: string;
  verifier: string;
  title: string;
  description?: string;
  paymentAmount: number;
  usdcMint: string;
  requirements: unknown[];
}

export function toSafeNumber(v: bigint | number): number {
  const n = typeof v === "bigint" ? Number(v) : v;
  if (!Number.isSafeInteger(n)) throw new Error("Amount exceeds safe integer range");
  return n;
}

export async function registerJob(db: PrismaClient, input: RegisterJobInput) {
  if (!Number.isSafeInteger(input.paymentAmount) || input.paymentAmount <= 0) {
    throw new ApiError("VALIDATION_ERROR", "paymentAmount must be a positive safe integer");
  }
  try {
    const job = await db.job.create({
      data: {
        jobId: input.jobId,
        jobPda: input.jobPda,
        business: input.business,
        worker: input.worker,
        verifier: input.verifier,
        title: input.title,
        description: input.description ?? "",
        paymentAmount: BigInt(input.paymentAmount),
        usdcMint: input.usdcMint,
        state: "CREATED",
        requirements: input.requirements as any,
      },
    });
    await appendActivity(db, { jobId: job.id, type: "JOB_CREATED", actor: input.business });
    logger.info("job registered", { jobId: job.id });
    return job;
  } catch (e: any) {
    if (e?.code === "P2002") throw conflict("Job already registered (duplicate jobId/jobPda)");
    throw e;
  }
}

export async function getJob(db: PrismaClient, id: string) {
  const job = await db.job.findUnique({ where: { id } });
  if (!job) throw notFound("Job");
  return job;
}

/** Resolve by database id first, then by on-chain jobId (mobile clients). */
export async function getJobSafe(db: PrismaClient, idOrJobId: string) {
  return (
    (await db.job.findUnique({ where: { id: idOrJobId } })) ??
    (await db.job.findUnique({ where: { jobId: idOrJobId } }))
  );
}

export async function transitionJob(
  db: PrismaClient,
  id: string,
  to: JobState,
  activity?: { type: Parameters<typeof appendActivity>[1]["type"]; actor?: string; txSignature?: string; metadata?: Record<string, unknown> }
) {
  const job = await getJob(db, id);
  try {
    assertTransition(job.state as JobState, to);
  } catch (e: any) {
    throw new ApiError("UNPROCESSABLE", e.message);
  }
  const updated = await db.job.update({ where: { id }, data: { state: to } });
  if (activity) await appendActivity(db, { jobId: id, ...activity });
  logger.info("job transitioned", { jobId: id, from: job.state, to });
  return updated;
}
