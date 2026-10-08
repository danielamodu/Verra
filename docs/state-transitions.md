# State Transitions — ProofPay V1 (+ Phase 2 verification linkage)

> Phase 2 does not change the on-chain state machine. It defines what
> authorizes the `SUBMITTED → VERIFIED` edge: a deterministic off-chain
> `VerificationResult`. See `docs/verification.md` and `verification/`.

## Diagram

```
                    fund_job              accept_job           submit_job
          CREATED ───────────▶ FUNDED ───────────────▶ IN_PROGRESS ──────────────▶ SUBMITTED
             │                                                                ┌──────┴──────┐
             │                                                                │             │
             │                                                      verify_job │             │ reject_job
             │                                                                ▼             ▼
             │                                                            VERIFIED       REJECTED
             │                                                                │             │
             │                                                   release_payment│             │ resubmit_job (worker)
             │                                                                ▼             ▼
             │                                                             SETTLED ──▶ (terminal)
             │                                                                          IN_PROGRESS
             │                                                                          (resubmission loop)
```

Terminal state: `SETTLED`. No transitions out.

## Transition table (enforced on-chain)

| # | Instruction | From | To | Required signer | Extra checks |
|---|---|---|---|---|---|
| 1 | `create_job` | — | `CREATED` | `business` | `amount > 0`; worker/verifier ≠ default; worker ≠ business |
| 2 | `fund_job` | `CREATED` | `FUNDED` | `business == job.business` | all mints == `job.usdc_mint`; `business_ata.amount >= payment_amount`; transfers exact amount |
| 3 | `accept_job` | `FUNDED` | `IN_PROGRESS` | `worker == job.worker` | — |
| 4 | `submit_job` | `IN_PROGRESS` | `SUBMITTED` | `worker == job.worker` | — |
| 5 | `verify_job` | `SUBMITTED` | `VERIFIED` | `verifier == job.verifier` | — |
| 6 | `reject_job` | `SUBMITTED` | `REJECTED` | `verifier == job.verifier` | — |
| 7 | `resubmit_job` | `REJECTED` | `IN_PROGRESS` | `worker == job.worker` | re-enters submit → verify/reject loop |
| 8 | `release_payment` | `VERIFIED` | `SETTLED` | `settlement_authority == job.verifier` | escrow + destination mints == `job.usdc_mint`; destination owner == `job.worker`; escrow balance ≥ amount; PDA-signed transfer of exact amount |

## Failure modes (all revert, no state change)

- **Premature release**: `release_payment` from `CREATED / FUNDED / IN_PROGRESS / SUBMITTED / REJECTED / SETTLED` → `PrematureRelease`.
- **Double settlement**: second `release_payment` finds `SETTLED ≠ VERIFIED` → `PrematureRelease`.
- **Wrong role**: any signer ≠ recorded authority → `UnauthorizedBusiness / UnauthorizedWorker / UnauthorizedVerifier / UnauthorizedSettlement`.
- **Wrong mint**: any token account mint ≠ `job.usdc_mint` → `InvalidMint`.
- **Wrong destination**: `worker_ata.owner ≠ job.worker` → `InvalidWorkerDestination`.
- **Skipped steps**: e.g. `submit` from `CREATED`, `verify` from `IN_PROGRESS`, `accept` from `CREATED` → `InvalidStateTransition`.
- Client-passed state is never read: every handler matches on the
  **on-chain** `job.state` before mutating.

## Events (one per transition)

`JobCreated`, `JobFunded`, `JobAccepted`, `JobSubmitted`, `JobVerified`,
`JobRejected`, `JobResubmitted`, `PaymentReleased` — each carries `job`,
`job_id`, and the relevant actor/amount for off-chain indexing.

## Verification linkage (Phase 2, off-chain → on-chain)

```
SUBMITTED (on-chain, after worker submit_job)
   │
   │  worker evidence payload (checklist + photo refs/hashes)
   ▼
VerificationService.submit → persist → engine → VerificationResult
   │                                   │
   │ VERIFIED                          │ REJECTED
   ▼                                   ▼
VerifyAuthorization ticket       no ticket; job stays unpaid,
   │                             worker resubmits (new submission_id)
   │ verifier keypair signs
   ▼
verify_job ──► VERIFIED (on-chain, program checks signer == verifier)
```

`verify_job` / `reject_job` remain callable by the verifier keypair holder
without an engine result (the program enforces only the signer + state).
The engine is the *policy* that tells the verifier keypair holder when
signing is warranted — the discipline is operational, documented in
`docs/verification.md`, and covered by `tests/verification-integration.ts`.
