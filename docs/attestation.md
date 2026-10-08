# Attestation lifecycle

Implementation: `verification/attestation.ts` (shared, pure) +
`backend/src/domain/attestations/service.ts` (persistence).

## Shape

```
job_id, submission_id, worker, device_id?
worker_signature?            # base64 ed25519 over the submission commitment
checks[]                     # { requirement, passed, reason }
evidence_hashes[]            # { evidence_id, requirement_id, content_hash }
result                       # VERIFIED only (rows never exist for REJECTED)
reason, verified_at, verifier
verify_signature?            # verify_job tx, attached after on-chain verify
```

## Lifecycle

1. **Mint** (`createAttestation`, post-VERIFIED only): built from the
   STORED submission + engine result via `buildAttestation`; optional
   worker signature attached; `canonicalDigest` pinned; row created
   (existing submission attestation returned idempotently).
2. **Authorize**: `authorizeFor` rebuilds a live `VerifyAuthorization`
   ticket — throws for anything but VERIFIED. The ticket is worthless
   without the live verifier key (checked inside `verifyJobOnChain`).
3. **Re-validate** (`verifyAttestationDigest`): at settle time the row is
   rebuilt and re-digested; ANY edit (reason, checks, worker, digest
   itself) fails validation and refuses settlement. Proven by
   “tampered attestation rows fail digest validation” + “refuses tampered
   attestations”.
4. **Seal**: `verifySignature` written after `verify_job` confirms.

## Digests

- `submissionCommitment`: sha256 over job/worker/submission/checklist
  outcomes/evidence hashes only (no timestamps, no local URIs) — the exact
  bytes the worker wallet signs, reproducible by worker, service, verifier.
- `attestationDigest`: sha256 over canonical JSON of the attestation
  MINUS signatures (signatures sign content, not themselves).

## Worker signatures

`verifyWorkerSignature` (ed25519, @noble/curves) checks an optional
submission signature against the recorded worker pubkey. Present-but-invalid
→ 422 at intake. Absent → allowed; the attestation records its absence.
Signed-then-validated end-to-end in `tests/attestation.unit.ts`.
