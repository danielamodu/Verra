import { Router } from "express";
import { ApiError } from "./errors";
import { serialize } from "./serialize";
import { intakeSubmission } from "../domain/submissions/service";
import { runVerification } from "../domain/verification/service";
import type { EvidenceStore } from "../infrastructure/storage/evidenceStore";
import type { PrismaClient } from "@prisma/client";

export function submissionsRouter(db: PrismaClient, store: EvidenceStore) {
  const r = Router();

  // Intake a worker submission. NEVER accepts `verified: true` — there is
  // no such field; the verdict comes only from the verification domain.
  r.post("/", async (req, res, next) => {
    try {
      if (req.body && typeof req.body.verified !== "undefined") {
        throw new ApiError("VALIDATION_ERROR", "Client-provided verdicts are not accepted");
      }
      const submission = await intakeSubmission(db, store, req.body);
      res.status(201).json(serialize(submission));
    } catch (e) {
      next(e);
    }
  });

  r.get("/:id", async (req, res, next) => {
    try {
      const submission = await db.submission.findUnique({
        where: { id: req.params.id },
        include: { evidence: { orderBy: { position: "asc" } } },
      });
      if (!submission) throw new ApiError("NOT_FOUND", "Submission not found");
      res.json(serialize(submission));
    } catch (e) {
      next(e);
    }
  });

  return r;
}

export function verificationRouter(db: PrismaClient) {
  const r = Router();

  // Run the deterministic engine over a stored submission.
  r.post("/:submissionId", async (req, res, next) => {
    try {
      const { attempt, result, attestation } = await runVerification(
        db,
        req.params.submissionId
      );
      res.json(serialize({ attempt, result, attestationId: attestation?.id ?? null }));
    } catch (e) {
      next(e);
    }
  });

  r.get("/:submissionId", async (req, res, next) => {
    try {
      const attempt = await db.verificationAttempt.findFirst({
        where: { submissionId: req.params.submissionId },
        orderBy: { createdAt: "desc" },
      });
      if (!attempt) throw new ApiError("NOT_FOUND", "No verification attempt");
      res.json(serialize(attempt));
    } catch (e) {
      next(e);
    }
  });

  return r;
}
