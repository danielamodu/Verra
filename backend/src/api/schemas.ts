import { z } from "zod";

const base58 = /^[1-9A-HJ-NP-Za-km-z]+$/;

export const jobRegisterSchema = z.object({
  jobId: z.string().min(1),
  jobPda: z.string().min(1),
  business: z.string().regex(base58, "business must be base58"),
  worker: z.string().regex(base58, "worker must be base58"),
  verifier: z.string().regex(base58, "verifier must be base58"),
  title: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  paymentAmount: z.number().int().positive(),
  usdcMint: z.string().regex(base58, "usdcMint must be base58"),
  requirements: z.array(z.unknown()).min(1),
  chain: z
    .object({
      createTx: z.string().min(1),
      fundTx: z.string().min(1),
    })
    .optional(),
});

export const jobAcceptSchema = z.object({
  worker: z.string().regex(base58),
  acceptTx: z.string().min(1),
});

export const settleRequestSchema = z.object({
  jobId: z.string().min(1),
  attestationId: z.string().min(1).optional(),
});
