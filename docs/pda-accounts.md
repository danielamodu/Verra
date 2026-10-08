# PDA / Account Structure — ProofPay V1

Program ID (placeholder, localnet + devnet until `anchor keys sync`):
`PPay111111111111111111111111111111111111111`

## 1. Job PDA (single source of truth)

| Item | Value |
|---|---|
| Seeds | `["job", business_pubkey, job_id_le8]` |
| `job_id` encoding | `u64` little-endian, 8 bytes |
| Space | `8 (discriminator) + Job::INIT_SPACE` |
| Payer | `business` at `create_job` |
| Mutability | `init` in `create_job`, `mut` afterwards |

`job_id` must be unique **per business**. Different businesses can reuse the
same numeric id because the business pubkey is part of the seed.

### Job layout (V1 — frozen order)

| Field | Type | Set by | Notes |
|---|---|---|---|
| `job_id` | `u64` | `create_job` | PDA seed component |
| `business` | `Pubkey` | `create_job` (signer) | pays + funds |
| `worker` | `Pubkey` | `create_job` arg | fixed at creation; `accept/submit/resubmit` signer |
| `verifier` | `Pubkey` | `create_job` arg | `verify/reject` signer; also settlement authority |
| `payment_amount` | `u64` | `create_job` arg | USDC base units (6 dp). `$150 = 150_000_000`. Must be `> 0` |
| `usdc_mint` | `Pubkey` | `create_job` (mint account) | locked; every token account must match |
| `state` | `JobState` | transitions | never trusted from client; checked on-chain |
| `created_at` | `i64` | `Clock` | unix timestamp |
| `bump` | `u8` | canonical bump | reused as PDA signer seed in `release_payment` |

Size: `8 + 8 + 32*4 + 8 + 32 + 1 + 8 + 1 = 194 bytes` (+ discriminator).

## 2. Escrow ATA (program-controlled)

| Item | Value |
|---|---|
| Address | SPL Associated Token Account: `findAssociatedTokenAddress(job_pda, usdc_mint)` |
| Mint | `job.usdc_mint` (enforced) |
| Authority / owner | **Job PDA** |
| Created in | `fund_job` (`init_if_needed`, payer = business) |
| Funded with | exactly `payment_amount` via CPI `token::transfer` from `business_ata` |
| Drained by | **only** `release_payment` via PDA-signed CPI to `worker_ata` |

Why an ATA and not a bare token account: deterministic derivation
(`job` → escrow), no extra bump bookkeeping, standard wallet/explorer
support. The Job PDA as owner means no private key can move the funds —
only the program's `release_payment` path with seeds
`["job", business, job_id_le8, bump]` can sign.

Invariants:
- After `fund_job`, `escrow_ata.amount == payment_amount`.
- `release_payment` requires `escrow_ata.amount >= payment_amount` then
  transfers exactly `payment_amount`; post-settlement balance is `0`.
- The worker has **no** signing authority over escrow and cannot withdraw
  directly — there is no instruction path for it.

## 3. Supporting accounts per instruction

| Instruction | Signer | Key accounts |
|---|---|---|
| `create_job` | `business` | `job` (init PDA), `usdc_mint` (Mint), `system_program` |
| `fund_job` | `business` | `job` (mut PDA), `usdc_mint`, `business_ata` (mut, `authority=business`), `escrow_ata` (init_if_needed ATA, `authority=job`), token/associated/system programs |
| `accept_job` | `worker` | `job` (mut PDA) |
| `submit_job` | `worker` | `job` (mut PDA) |
| `verify_job` | `verifier` | `job` (mut PDA) |
| `reject_job` | `verifier` | `job` (mut PDA) |
| `resubmit_job` | `worker` | `job` (mut PDA) |
| `release_payment` | `settlement_authority` (= `job.verifier`) | `job` (mut PDA, signer for CPI), `escrow_ata` (mut, `authority=job`, `mint=job.usdc_mint`), `worker_ata` (mut, owner must be `job.worker`, mint must be `job.usdc_mint`), `token_program` |

`worker_ata` is intentionally a plain `Account<TokenAccount>` (not an
`associated_token` constraint) so the handler can emit the precise
`InvalidWorkerDestination` / `InvalidMint` errors; mint + owner are still
validated on-chain.

## 4. Worked example

```
business = 7x...A, job_id = 42
job_pda  = findProgramAddress(["job", 7x...A, le_bytes(42)])
escrow   = findAssociatedTokenAddress(job_pda, <usdc_mint>)
```

Client derivation (TS):
```ts
const [job] = PublicKey.findProgramAddressSync(
  [Buffer.from("job"), business.toBuffer(), jobId.toArrayLike(Buffer, "le", 8)],
  program.programId
);
const escrowAta = await getAssociatedTokenAddress(usdcMint, job, true);
```
(`allowOwnerOffCurve = true` because the owner is a PDA.)
