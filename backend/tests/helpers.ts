/** Backend test helpers: app factory, DB wipe, fixtures, secret scan. */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import request from "supertest";
import { PrismaClient } from "@prisma/client";
import { createApp } from "../src/api/app";
import { closePrisma, getPrisma } from "../src/infrastructure/db/client";
import { EvidenceStore } from "../src/infrastructure/storage/evidenceStore";
import type { SolanaContext } from "../src/infrastructure/solana/context";

export function testStore(): EvidenceStore {
  return new EvidenceStore(fs.mkdtempSync(path.join(os.tmpdir(), "verra-ev-")));
}

export function testApp(solana: SolanaContext | null = null) {
  return createApp({
    db: getPrisma(),
    solana,
    store: testStore(),
    config: {
      programId: "EmAPVEMNMa5vmS2GaFSjfNjg1JeWyUhy4fCe3c6PyoMp",
      rpcUrl: "https://api.devnet.solana.com",
      usdcMint: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
    },
  });
}

export { request, closePrisma };

const TABLES = [
  "ActivityEvent",
  "Settlement",
  "VerificationAttestation",
  "VerificationAttempt",
  "Evidence",
  "Submission",
  "Job",
] as const;

export async function wipe(db: PrismaClient) {
  for (const t of TABLES) {
    await (db as any)[t[0].toLowerCase() + t.slice(1)].deleteMany();
  }
}

/** Assert no key material leaks into API responses. */
export function assertNoSecrets(value: unknown, path = "$"): void {
  if (value === null || value === undefined) return;
  if (typeof value === "string") {
    if (/secret|mnemonic|seed phrase/i.test(value) && value.length > 20) {
      throw new Error(`Possible secret at ${path}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => assertNoSecrets(v, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (/secret|mnemonic|privateKey|seedPhrase/i.test(k)) {
        throw new Error(`Secret field leaked at ${path}.${k}`);
      }
      assertNoSecrets(v, `${path}.${k}`);
    }
  }
}

export const REQS: any[] = [
  {
    id: "visit-checklist",
    type: "CHECKLIST",
    label: "Checklist",
    required: true,
    configuration: { items: [{ id: "s1", label: "Store 1" }] },
  },
  {
    id: "store-photos",
    type: "PHOTO_EVIDENCE",
    label: "Photos",
    required: true,
    configuration: { minPhotos: 1 },
  },
];

export function validSubmissionPayload(jobId: string, worker: string, subId: string) {
  return {
    jobId,
    worker,
    submissionId: subId,
    checklistResults: [{ requirement_id: "visit-checklist", completed: true }],
    evidence: [
      {
        requirementId: "store-photos",
        type: "PHOTO_EVIDENCE",
        storageRef: "evidence://store-photos/s1.jpg",
        contentHash: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
        capturedAt: "2026-01-15T11:00:00.000Z",
        metadata: {},
      },
    ],
    submittedAt: "2026-01-15T12:00:00.000Z",
  };
}
