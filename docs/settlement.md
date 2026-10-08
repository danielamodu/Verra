# Settlement lifecycle

Implementation: `backend/src/domain/settlement/service.ts`
(`settleJob`), driven by `POST /api/settle`.

## Preconditions (all verified before any transaction)

1. Job exists; attestation resolved (explicit id or latest VERIFIED).
2. Attestation belongs to the job, `result` is VERIFIED, worker matches.
3. Stored row re-digests to its pinned `canonicalDigest` (tamper check).
4. Worker signature re-validates when present.
5. `VerifyAuthorization` ticket builds (VERIFIED-only gate).
6. Job backend-state is VERIFIED (replays skip this via idempotency first).

## Execution (reconcile-then-act)

1. Read the on-chain job. Missing → fail. SETTLED without a CONFIRMED row
   → hard error for operator reconciliation (never re-release blindly).
   Anything but SUBMITTED/VERIFIED → fail.
2. `PENDING → VERIFYING`: if chain is SUBMITTED, send `verify_job`
   (verifier key), confirm, store `verifyTx`, seal the attestation. If the
   chain already shows VERIFIED (previous attempt landed it), skip re-send —
   re-sending would revert.
3. `VERIFYING → RELEASING`: snapshot worker balance, send
   `release_payment`, confirm, require
   `balanceAfter − balanceBefore == paymentAmount` exactly.
4. `→ CONFIRMED`: job SETTLED, `PAYMENT_RELEASED` activity, receipt data
   `{ settlementId, verifyTx, releaseTx, amount, recipient, confirmedAt }`.

Any failure → `FAILED` + `error` persisted + `SETTLEMENT_FAILED`
activity; the job stays VERIFIED and escrow untouched. Retry re-runs the
same flow safely.

## Idempotency

- `Settlement.jobId` UNIQUE (+ `attestationId` unique): concurrent double
  submits collapse to one row (P2002 race guard included).
- CONFIRMED replays return the row with zero new transactions (proven:
  `calls.verify == 1, calls.release == 1` across replays).
- Busy rows (PENDING/VERIFYING/RELEASING) → 409, never a second tx.
- FAILED rows retry from a clean PENDING with prior tx fields cleared.

## Receipt rule

Receipt data (and the mobile Verra Receipt success layout) exists only for
CONFIRMED settlements. `GET /api/settlements/:jobId` is 404 until then.
