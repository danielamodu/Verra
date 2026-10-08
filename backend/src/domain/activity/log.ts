/** Append-only activity log. No update/delete API exists by design. */
import type { PrismaClient } from "@prisma/client";
import { logger } from "../../logger";

export type ActivityInput = {
  jobId: string;
  type:
    | "JOB_CREATED"
    | "FUNDED"
    | "ACCEPTED"
    | "SUBMITTED"
    | "VERIFICATION_STARTED"
    | "VERIFIED"
    | "REJECTED"
    | "SETTLEMENT_STARTED"
    | "PAYMENT_RELEASED"
    | "SETTLEMENT_FAILED";
  actor?: string;
  metadata?: Record<string, unknown>;
  txSignature?: string;
};

export async function appendActivity(db: PrismaClient, input: ActivityInput) {
  const event = await db.activityEvent.create({
    data: {
      jobId: input.jobId,
      type: input.type as any,
      actor: input.actor,
      metadata: (input.metadata ?? {}) as any,
      txSignature: input.txSignature,
    },
  });
  logger.info("activity appended", {
    jobId: input.jobId,
    txSignature: input.txSignature,
    activityType: input.type,
  });
  return event;
}

export async function listActivity(db: PrismaClient, jobId: string) {
  return db.activityEvent.findMany({
    where: { jobId },
    orderBy: { timestamp: "asc" },
  });
}
