import { Router } from "express";
import { ApiError } from "./errors";
import { serialize } from "./serialize";
import { settleRequestSchema } from "./schemas";
import { settleJob } from "../domain/settlement/service";
import { getJobSafe } from "../domain/jobs/service";
import type { SolanaContext } from "../infrastructure/solana/context";
import type { PrismaClient } from "@prisma/client";

export function settleRouter(db: PrismaClient, solana: SolanaContext | null) {
  const r = Router();

  r.post("/", async (req, res, next) => {
    try {
      if (!solana) {
        throw new ApiError("UPSTREAM_ERROR", "Settlement is unavailable (no Solana context)");
      }
      const parsed = settleRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError("VALIDATION_ERROR", "Invalid settle payload", parsed.error.flatten());
      }
      const settlement = await settleJob(db, solana, parsed.data);
      res.json(
        serialize({
          settlementId: settlement.id,
          jobId: settlement.jobId,
          status: settlement.status,
          verifyTx: settlement.verifyTx,
          releaseTx: settlement.releaseTx,
          amount: settlement.amount,
          recipient: settlement.recipient,
          confirmedAt: settlement.confirmedAt,
        })
      );
    } catch (e) {
      next(e);
    }
  });

  r.get("/:jobId", async (req, res, next) => {
    try {
      const job = await db.job.findFirst({ where: { jobId: req.params.jobId } });
      if (!job) throw new ApiError("NOT_FOUND", "Job not found");
      const settlement = await db.settlement.findUnique({ where: { jobId: job.id } });
      if (!settlement) throw new ApiError("NOT_FOUND", "No settlement for this job");
      res.json(serialize(settlement));
    } catch (e) {
      next(e);
    }
  });

  return r;
}

export function activityRouter(db: PrismaClient) {
  const r = Router();

  // The mobile timeline reads persisted events — never fabricated state.
  r.get("/jobs/:id/activity", async (req, res, next) => {
    try {
      const job = await getJobSafe(db, req.params.id);
      if (!job) throw new ApiError("NOT_FOUND", "Job not found");
      const events = await db.activityEvent.findMany({
        where: { jobId: job.id },
        orderBy: { timestamp: "asc" },
      });
      res.json(serialize(events));
    } catch (e) {
      next(e);
    }
  });

  return r;
}
