import express from "express";
import type { PrismaClient } from "@prisma/client";
import { ApiError } from "./errors";
import { jobsRouter } from "./jobs";
import { submissionsRouter, verificationRouter } from "./submissions";
import { activityRouter, settleRouter } from "./settle";
import type { EvidenceStore } from "../infrastructure/storage/evidenceStore";
import type { SolanaContext } from "../infrastructure/solana/context";
import type { BackendConfig } from "../config";

export interface AppDeps {
  db: PrismaClient;
  solana: SolanaContext | null;
  store: EvidenceStore;
  config: Pick<BackendConfig, "programId" | "rpcUrl" | "usdcMint">;
}

export function createApp(deps: AppDeps) {
  const app = express();
  app.use(express.json({ limit: "2mb" }));

  app.get("/health", (_req, res) => {
    res.json({ ok: true, solana: deps.solana ? "configured" : "unavailable" });
  });
  app.get("/api/config", (_req, res) => {
    // Public, non-sensitive cluster configuration for mobile clients.
    res.json({
      programId: deps.config.programId,
      rpcUrl: deps.config.rpcUrl,
      usdcMint: deps.config.usdcMint,
    });
  });

  app.use("/api/jobs", jobsRouter(deps.db, deps.solana));
  app.use("/api/submissions", submissionsRouter(deps.db, deps.store));
  app.use("/api/verification", verificationRouter(deps.db));
  app.use("/api/settle", settleRouter(deps.db, deps.solana));
  app.use("/api", activityRouter(deps.db));

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err instanceof ApiError) {
      res.status(err.status).json(err.toJSON());
      return;
    }
    if (err instanceof SyntaxError) {
      res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid JSON" } });
      return;
    }
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Internal error" } });
  });

  return app;
}
