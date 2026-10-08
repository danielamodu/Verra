# Verra data model (PostgreSQL + Prisma)

Source of truth: `backend/prisma/schema.prisma`. Amounts are base-unit
integers (`BigInt`) — exact USDC accounting, no floats. API responses
serialize them as numbers (safe-integer enforced).

## Tables

**Job** — lifecycle row. `jobId` (on-chain u64 decimal) and `jobPda`
unique; `@@unique` semantics keep one row per on-chain job. `state`:
CREATED → FUNDED → IN_PROGRESS → SUBMITTED → VERIFIED → SETTLED, plus
SUBMITTED → REJECTED → SUBMITTED (resubmission). Indexes: `state`, `worker`.

**Submission** — the client `submissionId` IS the primary key: natural
idempotency (duplicates → 409, plus a P2002 race guard). `commitment` is the
server-computed submission digest; `workerSignature` optional but verified
when present. `status`: RECEIVED → VERIFIED/REJECTED.

**Evidence** — one row per photo with stable `position` (deterministic
digest order), `contentHash` (lowercase hex SHA-256), `capturedAt`, optional
`metadata`. Raw bytes live in content-addressed disk storage only when
uploaded (`contentBase64`), always hash-verified on write.

**VerificationAttempt** — every engine run is stored (status, checks,
reason). History, not just latest — re-runs append.

**VerificationAttestation** — only VERIFIED results produce a row
(`submissionId` unique). Carries `requirements`/`evidenceCommitments`
snapshots, `canonicalDigest` (unique — detects duplicate issuance),
`workerSignature`, `verifySignature` (set after on-chain verify), plus
operational `checks`/`reason`/`verifiedAt` so the digest is fully
re-validatable from the row alone.

**Settlement** — `jobId` UNIQUE: the database itself makes double-pay
impossible. `attestationId` unique. States: PENDING → VERIFYING →
RELEASING → CONFIRMED, with FAILED for retryable failures. `verifyTx` /
`releaseTx` / `error` record exactly what happened.

**ActivityEvent** — append-only (no update/delete API). Types:
JOB_CREATED, FUNDED, ACCEPTED, SUBMITTED, VERIFICATION_STARTED, VERIFIED,
REJECTED, SETTLEMENT_STARTED, PAYMENT_RELEASED, SETTLEMENT_FAILED.
Indexed by `(jobId, timestamp)` — the mobile timeline reads this.

## Invariants enforced below the application

- PK/FK graph with cascading deletes from Job.
- Unique: `Job.jobId`, `Job.jobPda`, `Submission.id`, `Attestation.submissionId`,
  `Attestation.canonicalDigest`, `Settlement.jobId`, `Settlement.attestationId`.
