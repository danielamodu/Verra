# Verra backend API

Base URL: `http://localhost:4000` (dev). All bodies/returns are JSON.
Errors: `{ error: { code, message } }` with HTTP 400/404/409/422/502/500.
BigInt amounts serialize as numbers. No endpoint accepts, returns, or logs
key material.

## Jobs

- `POST /api/jobs` — register. Body: `jobId, jobPda, business, worker,
  verifier, title, description?, paymentAmount (>0 int), usdcMint,
  requirements[], chain? { createTx, fundTx }`. With `chain`, the account is
  reconciled live (must exist, state FUNDED, mint + amount match) and the
  job records FUNDED; otherwise CREATED. Duplicates → 409.
- `GET /api/jobs/:id` — by database id or on-chain jobId.
- `POST /api/jobs/:id/accept` — body `{ worker, acceptTx }`. Reconciles
  on-chain IN_PROGRESS (when chain configured), then FUNDED → IN_PROGRESS.
  Wrong worker → 422.

## Submissions

- `POST /api/submissions` — body `{ jobId (on-chain), worker,
  submissionId, checklistResults[], evidence[] ({ requirementId, type,
  storageRef, contentHash (hex SHA-256), capturedAt, metadata?,
  contentBase64? }), workerSignature?, submittedAt }`. Any `verified` field
  → 400. Validates job acceptance state, worker binding, hash/timestamp
  shape, signature-if-present; persists submission + evidence rows;
  transitions the job to SUBMITTED; appends SUBMITTED. Duplicate
  `submissionId` → 409.
- `GET /api/submissions/:id` — submission with ordered evidence.

## Verification

- `POST /api/verification/:submissionId` — runs the deterministic engine
  over stored rows, persists the attempt, transitions the job
  (VERIFIED/REJECTED), mints the attestation on VERIFIED. Returns
  `{ attempt, result, attestationId }`.
- `GET /api/verification/:submissionId` — latest attempt.

## Settlement

- `POST /api/settle` — body `{ jobId, attestationId? }`. Full gate +
  reconcile-then-act flow (see `docs/settlement.md`). Returns receipt data
  on CONFIRMED; replays return the existing row; busy → 409.
- `GET /api/settlements/:jobId` — settlement row or 404 (no receipt exists
  before CONFIRMED).

## Activity & ops

- `GET /api/jobs/:id/activity` — persisted timeline (mobile reads this).
- `GET /health` — `{ ok, solana: configured|unavailable }`.
- `GET /api/config` — public cluster config `{ programId, rpcUrl,
  usdcMint }` for mobile clients.

## Mobile mapping (already implemented in `mobile/src/backend/SolanaBackend.ts`)

`submitCompletion` → `POST /api/submissions` (camelCase-mapped),
`getSubmission` → `GET /api/submissions/:id`,
`requestSettlement` → `POST /api/settle { jobId }`,
plus `POST /api/jobs` (with chain proof) and `POST /api/jobs/:id/accept`
after the MWA-signed create/fund/accept transactions.
