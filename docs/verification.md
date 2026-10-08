# Verification Engine — ProofPay Phase 2

Deterministic off-chain verification for V1. Two requirement types only:
`CHECKLIST` and `PHOTO_EVIDENCE`. No AI, no randomness, no network calls.

## What constitutes valid evidence

A `Submission` (see `verification/schema.ts`) is valid only if:

- `job_id` is the decimal string of the on-chain u64 job id, and matches the
  job the service instance is bound to. Anything else = wrong-job failure.
- `worker` is the base58 pubkey recorded on-chain at `create_job`, and
  matches the service binding. Anything else = wrong-worker failure.
- `submitted_at` is a valid ISO-8601 timestamp.
- `checklist_results` is an array of `{ requirement_id, completed: boolean }`
  (strict boolean; no truthy strings, no missing fields).
- `evidence` items each carry: non-empty `id` / `requirement_id` /
  `storage_ref`, `type: "PHOTO_EVIDENCE"`, a `content_hash` that is a
  lowercase hex SHA-256 (64 chars), a `captured_at` timestamp that parses
  and is not after `submitted_at`, and a `metadata` object.
- Every result/evidence references a **known** requirement of matching type;
  duplicates (two results for one requirement, two evidence items with one
  id) are rejected. The engine fails closed on any structural defect.

Content integrity: when raw bytes are available (upload time), the service
pins `content_hash = sha256(bytes)` (`verification/evidence.ts`). Anyone can
re-hash and compare with `verifyEvidenceContent` (constant-time). The engine
itself operates on the hash/reference — it never trusts a client-provided
"verified" flag, and there is no such flag anywhere in the schema.

## What the verifier checks (fixed rules, in order)

1. **Structure** — malformed submission = `REJECTED`.
2. **Identity** — wrong job or wrong worker = `REJECTED`.
3. **Per requirement, in requirements order:**
   - `CHECKLIST` (required): a result exists **and** `completed === true`.
     Missing or `false` = failure.
   - `PHOTO_EVIDENCE` (required): at least `minPhotos` qualifying evidence
     items reference the requirement. Fewer = failure.
   - Optional requirements never fail; the check records skipped/recorded.
4. `VERIFIED` only if every check passed. Each check states
   `{ requirement, passed, reason }`; the overall `reason` is the first
   failure, or `all N requirement check(s) passed`.

The engine is pure: same input + same injected clock ⇒ byte-identical
`VerificationResult`. `verified_at` comes from an injected `now` (defaults
to `Date.now()`), so tests pin it and production passes wall-clock time.

## What remains off-chain

- Requirement definitions, submissions, evidence bytes/pointers, hashes,
  results, and the authorization ticket. Storage is an in-memory store in V1
  (`InMemorySubmissionStore` behind the `SubmissionStore` interface — swap
  for a database without touching engine or service).
- The verifier **keypair** (holds the authority to sign `verify_job`).

## What is enforced on-chain

Unchanged from Phase 1 (`programs/proofpay/src/lib.rs` was not modified):
`SUBMITTED → VERIFIED` only when the signer equals the recorded verifier;
escrow custody; single exact-amount settlement from `VERIFIED`. The program
knows nothing about checklists or photos — and must not.

## How verification authorizes settlement

```
worker client --(evidence only)--> VerificationService.submit()
        → store.save + engine → VerificationResult
        → VERIFIED ? authorizeOnChainVerify() → VerifyAuthorization ticket
                   : no ticket exists (throws)
        → verifyJobOnChain(ticket + verifier Keypair) → verify_job tx
        → on-chain state VERIFIED → release_payment may proceed
```

Three independent gates, all required: (1) engine verdict from stored data,
(2) server-side ticket issuance (REJECTED cannot produce one — the method
throws), (3) the live verifier key signature on the transaction. A leaked
ticket alone verifies nothing; a client-sent `verified: true` is not a
concept in the system — there is no field, endpoint, or instruction that
accepts it.

## Example job

"Inspect 10 stores", 150 USDC (`verification/example-job.ts`):
`visit-checklist` (required CHECKLIST, 10 items) + `store-photos`
(required PHOTO_EVIDENCE, `minPhotos: 10`). `validStoreSubmission` builds a
fully valid submission with correct content hashes.
