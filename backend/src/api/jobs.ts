import { Router } from "express";
import { PublicKey } from "@solana/web3.js";
import { ApiError } from "./errors";
import { serialize } from "./serialize";
import { jobAcceptSchema, jobRegisterSchema } from "./schemas";
import { getJob, getJobSafe, registerJob, transitionJob } from "../domain/jobs/service";
import { appendActivity } from "../domain/activity/log";
import { readChainJob, type SolanaContext } from "../infrastructure/solana/context";
import type { PrismaClient } from "@prisma/client";

export function jobsRouter(db: PrismaClient, solana: SolanaContext | null) {
  const r = Router();

  // Register a job. With `chain` proof, reconcile against the live account
  // and record FUNDED; otherwise the job starts CREATED.
  r.post("/", async (req, res, next) => {
    try {
      const parsed = jobRegisterSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError("VALIDATION_ERROR", "Invalid job payload", parsed.error.flatten());
      }
      const body = parsed.data;
      const job = await registerJob(db, {
        jobId: body.jobId,
        jobPda: body.jobPda,
        business: body.business,
        worker: body.worker,
        verifier: body.verifier,
        title: body.title,
        description: body.description,
        paymentAmount: body.paymentAmount,
        usdcMint: body.usdcMint,
        requirements: body.requirements,
      });
      if (body.chain && solana) {
        const chain = await readChainJob(
          solana.program,
          new PublicKey(body.jobPda)
        );
        if (!chain.exists) throw new ApiError("UNPROCESSABLE", "Job account not found on-chain");
        if (chain.state !== "FUNDED") {
          throw new ApiError("UNPROCESSABLE", `On-chain job is ${chain.state}, expected FUNDED`);
        }
        if (chain.usdcMint !== body.usdcMint || chain.paymentAmount !== body.paymentAmount) {
          throw new ApiError("UNPROCESSABLE", "On-chain job does not match registered terms");
        }
        await db.job.update({
          where: { id: job.id },
          data: { state: "FUNDED", createTx: body.chain.createTx, fundTx: body.chain.fundTx },
        });
        await appendActivity(db, {
          jobId: job.id,
          type: "FUNDED",
          actor: body.business,
          txSignature: body.chain.fundTx,
        });
        return res.status(201).json(serialize(await getJob(db, job.id)));
      }
      return res.status(201).json(serialize(job));
    } catch (e) {
      next(e);
    }
  });

  r.get("/:id", async (req, res, next) => {
    try {
      const job = await getJobSafe(db, req.params.id);
      if (!job) throw new ApiError("NOT_FOUND", "Job not found");
      res.json(serialize(job));
    } catch (e) {
      next(e);
    }
  });

  // Record worker acceptance with the on-chain accept tx as proof.
  // Accepts either the database id or the on-chain jobId (mobile clients
  // only know the on-chain id).
  r.post("/:id/accept", async (req, res, next) => {
    try {
      const parsed = jobAcceptSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ApiError("VALIDATION_ERROR", "Invalid accept payload", parsed.error.flatten());
      }
      const job =
        (await getJobSafe(db, req.params.id));
      if (!job) throw new ApiError("NOT_FOUND", "Job not found");
      if (parsed.data.worker !== job.worker) {
        throw new ApiError("UNPROCESSABLE", "Only the assigned worker can accept");
      }
      if (solana) {
        const chain = await readChainJob(solana.program, new PublicKey(job.jobPda));
        if (!chain.exists || chain.state !== "IN_PROGRESS") {
          throw new ApiError(
            "UNPROCESSABLE",
            `On-chain job is ${chain.state ?? "missing"}, expected IN_PROGRESS`
          );
        }
        await db.job.update({
          where: { id: job.id },
          data: { acceptTx: parsed.data.acceptTx },
        });
      }
      const updated = await transitionJob(db, job.id, "IN_PROGRESS", {
        type: "ACCEPTED",
        actor: job.worker,
        txSignature: parsed.data.acceptTx,
      });
      res.json(serialize(updated));
    } catch (e) {
      next(e);
    }
  });

  return r;
}
