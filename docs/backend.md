# Verra backend

Express + TypeScript + PostgreSQL (Prisma) + zod. Domain layout — no
framework code inside domain rules:

```
backend/
  prisma/schema.prisma        # PostgreSQL data model (+ migrations/)
  src/
    config.ts                 # env only (DATABASE_URL, RPC_URL, PROGRAM_ID,
                              #   USDC_MINT, VERIFIER_KEYPAIR_PATH, STORAGE_DIR)
    logger.ts                 # zero-dep structured JSON logs (ids, never keys)
    server.ts                 # composition root
    api/                      # HTTP: app.ts, jobs.ts, submissions.ts,
                              #   settle.ts (+activity), schemas.ts (zod),
                              #   errors.ts, serialize.ts
    domain/
      jobs/                   # transitions.ts (pure guard) + service.ts
      submissions/            # intake: validate → persist → SUBMITTED
      verification/           # run engine, persist attempts, mint attestations
      attestations/           # build/store/digest-verify (shared attestation.ts)
      settlement/             # idempotent verify→release→confirm flow
      activity/               # append-only log
    infrastructure/
      db/client.ts            # Prisma singleton
      storage/evidenceStore.ts# content-addressed evidence bytes (hash-verified)
      solana/context.ts       # connection, program, verifier key, reconcile
  tests/                      # mocha/chai/supertest via ts-mocha
```

## Domain boundaries

- `jobs`: lifecycle persistence + transition guard. The Solana program is
  the final authority; the backend rejects invalid transitions BEFORE any
  chain action and reconciles submitted proofs (create/fund/accept txs)
  against live accounts before recording FUNDED/IN_PROGRESS.
- `submissions`: structural integrity (shape, hashes, timestamps, worker
  binding, signature-if-present) + persistence. Semantic verdicts belong to
  verification. Never accepts `verified` from clients (400).
- `verification`: runs the existing deterministic engine over STORED rows,
  persists every attempt, transitions the job, mints an attestation only on
  VERIFIED. No ticket path exists for REJECTED.
- `attestations`: first-class rows with pinned digests; re-validation
  detects any tampering before settlement.
- `settlement`: idempotent, retry-safe, reconcile-then-act executor —
  see `docs/settlement.md`.
- `activity`: append-only timeline; the mobile Activity screen reads this.

## Running

```bash
# PostgreSQL 16 must be reachable (see DATABASE_URL in backend/.env.example)
cd backend
npm install
npx prisma migrate deploy
npm run lint            # tsc --noEmit
npm test                # unit + API suite (needs TEST_DATABASE_URL)
npm run test:slice       # REAL chain slice (needs CHAIN_URL + funded wallets)
npm run dev             # ts-mocha server on PORT
```

Test wallets/keys are ephemeral per run; only the operator verifier key
comes from `VERIFIER_KEYPAIR_PATH` and never leaves the backend process.
