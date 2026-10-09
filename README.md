# ProofPay V1 — verified field work → instant USDC settlement

Minimal working protocol on Solana (Anchor). Scope is frozen at 8
instructions, one payment asset (USDC), one state machine. No marketplace,
reputation, DAO, token, AI agents, GPS, or identity system.

## What V1 does

```
BUSINESS:  create_job → fund_job (USDC → PDA-owned escrow ATA)
WORKER:    accept_job → submit_job → (rejected? resubmit_job → submit_job)
VERIFIER:  verify_job | reject_job
PROGRAM:   release_payment (VERIFIED → SETTLED, escrow → worker, exactly once)
```

States: `CREATED → FUNDED → IN_PROGRESS → SUBMITTED → VERIFIED → SETTLED`,
plus `SUBMITTED → REJECTED → IN_PROGRESS` for the resubmission loop.

Details: `docs/state-transitions.md`, `docs/pda-accounts.md`.

## Repo layout

```
programs/proofpay/src/lib.rs   # the entire on-chain program (8 ix, Job account, errors, events)
tests/proofpay.ts              # Anchor integration tests (require validator; 15 cases incl. $150 e2e)
tests/state-machine.unit.ts    # offline mirror of the transition table (no validator needed)
docs/pda-accounts.md           # PDA / escrow / account reference
docs/state-transitions.md      # transition table + failure modes
Anchor.toml / Cargo.toml       # workspace config (npm-based scripts)
package.json / tsconfig.json   # TS client + test deps
```

## Prerequisites (exact)

| Tool | Version | Install on Windows |
|---|---|---|
| Node | 20+ (tested 24.12.0 natively, 20.20.1 under WSL) | https://nodejs.org or `winget install OpenJS.NodeJS` |
| npm | 10+ (tested 11.19.0) | ships with Node |
| WSL2 + Ubuntu | Ubuntu 24.04, WSL v2 | `wsl --install -d Ubuntu` in an admin prompt, then reboot |
| Rust + cargo | stable 1.80+ (validated with 1.98.1) | **inside Ubuntu:** `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \| sh -s -- -y --profile minimal` |
| Solana CLI | 1.18+ / 2.x+ (validated with Agave 4.3.0) | **inside Ubuntu:** `sh -c "$(curl -sSfL https://release.anza.xyz/stable/install)"` then add `~/.local/share/solana/install/active_release/bin` to `PATH`. NOTE: the legacy `release.solana.com` endpoint is dead — use `release.anza.xyz`. |
| Anchor CLI | 0.31.1 (must match `Anchor.toml`) | **inside Ubuntu:** `cargo install --git https://github.com/coral-xyz/anchor avm --force && avm install 0.31.1 && avm use 0.31.1` |
| C toolchain | gcc (Ubuntu 24.04 ships it) | preinstalled; if missing: `sudo apt-get install -y build-essential` (needs the Ubuntu user password) |

> Native Windows cannot run `anchor build` (the BPF toolchain is
> Linux-only). All `anchor` / `solana` commands below run **inside Ubuntu**
> (`wsl -d Ubuntu`). The repo itself can stay on the Windows disk and is
> reachable at `/mnt/c/Users/USER/Desktop/Proofpay`, but for faster builds
> copy it to `~/proofpay` first. This repo's scripts use **npm** (not yarn).

## Local setup (exact)

```bash
git clone <this-repo> && cd Proofpay
npm install

# 1. Start a local validator (terminal 1)
solana-test-validator

# 2. Point the wallet + provider at localnet (terminal 2)
solana config set --url localhost
solana-keygen new -o ~/.config/solana/id.json --no-bip39-passphrase --force
solana airdrop 10

# 3. Build + deploy
anchor keys sync          # writes the real program id into Anchor.toml + lib.rs
anchor build
anchor deploy             # or: solana program deploy target/deploy/proofpay.so

# 4. Run the FULL on-chain suite (localnet)
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/proofpay.ts
# or: anchor test   (requires yarn; same tests)

# 5. Fast offline check (no validator needed — always works)
npm run test:unit
npm run lint              # tsc --noEmit
```

## Devnet setup (exact)

```bash
solana config set --url devnet
solana-keygen new -o ~/.config/solana/id.json --no-bip39-passphrase --force
solana airdrop 2                          # devnet faucet; repeat if rate-limited

# Real Circle devnet USDC mint (6 decimals):
#   4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU
# Fund test USDC via https://faucet.circle.com (select SOL Devnet),
# or run the test suite, which creates its own 6-decimal mock mint so it
# passes on localnet AND devnet without faucet dependency.

anchor keys sync
anchor build
anchor deploy --provider.cluster devnet
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/proofpay.ts
```

`Anchor.toml` declares the program id for both `localnet` and `devnet`;
after `anchor keys sync` both entries are rewritten to the real keypair in
`target/deploy/proofpay-keypair.json`.

## Deployed on devnet (Phase 1.5 — proven 2026-09-30)

- Program ID: `EmAPVEMNMa5vmS2GaFSjfNjg1JeWyUhy4fCe3c6PyoMp`
- Deploy signature: `6c1TBnvTDC5WHmcPtXSu2HLcZbz6Z5YBpZWzYiBa7khkJ1yqhognqNopuWr5HpTMsGs8h4GHe4EbEAhSuBjaenY`
- Deployed in slot `505967062`; ProgramData `HQQYRxRxXgfej11HCXX7mgXWiqmovUjAtF5SQLV4ouwZ`
- Binary: `target/deploy/proofpay.so` (246,840 bytes, sha256 `b40bbd6c…f6d9`)
- Verify: `solana program show EmAPVEMNMa5vmS2GaFSjfNjg1JeWyUhy4fCe3c6PyoMp --url https://api.devnet.solana.com`
- On-chain suite: **15/15 passing on devnet** (`tests/proofpay.ts`).
  `$150` e2e: worker ATA went `5,000,000 → 155,000,000` (delta exactly
  `150,000,000`); release tx
  `22ssBFL3srbNFDATYsSwHL27AmKveocRLnhZzeYvr6pUCevWb79VFRBQJBMCCFc5LhMefmMuSRnJeeFz5DC78Ydq`.
- Upgrade authority: deployer wallet in WSL `~/.config/solana/id.json`;
  program keypair backed up at `C:\Users\USER\proofpay-keypair-backup.json`
  (keep both — losing the program keypair means losing upgradeability).
- Devnet faucet note: the public `requestAirdrop` faucet is heavily
  rate-limited; the test harness funds test wallets via transfers from
  `ANCHOR_WALLET` when set (falls back to airdrops on localnet).

## The $150 end-to-end proof

Test `"end-to-end: business funds $150 USDC → worker receives $150 USDC"`
(`tests/proofpay.ts`) performs the single required ceremony:

```
business funds 150_000_000 base units ($150.00, 6 dp)
→ worker accepts → worker submits → verifier verifies
→ worker balance increases by exactly 150_000_000, escrow → 0
```

## Phase 2 — Verification Engine (deterministic, off-chain)

Turns a worker submission into a `VERIFIED | REJECTED` result that
authorizes the existing on-chain `verify_job`. V1 supports `CHECKLIST` and
`PHOTO_EVIDENCE` only. No AI, no randomness. Full spec: `docs/verification.md`.

```
verification/schema.ts       # Requirement / Submission / Evidence / VerificationResult types
verification/engine.ts       # pure deterministic rules (structure → identity → per-requirement)
verification/evidence.ts     # SHA-256 hashing + constant-time content verification
verification/store.ts        # persistence boundary (in-memory V1; swap for DB later)
verification/service.ts      # API boundary: submit → persist → engine → ticket (VERIFIED only)
verification/onchain.ts      # ticket + verifier keypair → verify_job transaction
verification/example-job.ts  # "Inspect 10 stores", 150 USDC
tests/verification.unit.ts         # 14 unit tests, no validator needed
tests/verification-integration.ts  # FUNDED → … → engine VERIFIED → verify_job → on-chain VERIFIED
```

```bash
npm test            # offline: 15 protocol + 14 verification unit tests (29 total)
npm run test:devnet # on-chain: tests/proofpay.ts + tests/verification-integration.ts
                    # requires ANCHOR_PROVIDER_URL + ANCHOR_WALLET (devnet)
```

Integration proof (local validator, 2026-10-01): engine
`VERIFIED (all 2 requirement check(s) passed)` → `verify_job`
`2obcnSJYdcDVP28AZQWDo2BC2UhUatGhFQNufhaRvEvjVWhQ3PCzMsXgPSjWc2zV32bw7XGDXvKL1rAHMjPz94eo`
→ on-chain state `VERIFIED`. Devnet re-run pending faucet funds (see report).

## Phase 3 — Verra mobile app (Seeker/Android)

Verra turns proof of real-world work into programmable payment:
device → worker identity → camera/evidence → signed submission →
deterministic verification → attestation → Solana → USDC settlement.

- App: `mobile/` (Expo + TypeScript, package `app.verra.mobile`).
- Flow: Connect → Role → Business (home/create/fund) → Worker
  (job → checklist → camera → review → submit) → Verification
  (incl. evidence fingerprints) → Settlement → **Verra Receipt**.
- Reuses the shared engine/attestation untouched; adds the signed
  attestation object (`verification/attestation.ts`) and worker
  commitment signatures (Seed Vault signs via MWA `signMessages`).
- Demo backend runs the real engine and never fakes settlement
  (receipts carry `real: false`); devnet backend builds real MWA-signed
  Anchor transactions, with verify/settle executed by the backend API
  holding the verifier key (never on the phone).
- Docs: `docs/mobile.md` (stack + wiring), `docs/seeker.md` (exact
  Seeker usage, no marketing claims), `docs/verra-demo.md` (happy path +
  failed-submission contrast).
- Tests: `cd mobile && npm test` (20 jest + 5 node), `npm run secrets-check`.
- APK: `mobile/dist/app-debug.apk` (127 MB, debug) — package
  `app.verra.mobile`, versionCode 2, minSdk 24 / targetSdk 34.
  Built via `expo prebuild + assembleDebug` (JDK 17, SDK 34, NDK 26);
  sha256 `750f49c0…`. Sideload onto Seeker to run the demo in
  `docs/verra-demo.md`.

## Phase 4 — Verra backend (jobs → settlement, PostgreSQL)

Real backend (`backend/`, Express + Prisma + zod): job lifecycle with a
transition guard, submission intake (idempotent by submissionId, never
accepts client verdicts), engine-run verification with persisted attempts,
digest-pinned attestations, idempotent reconcile-then-act settlement
(`verify_job` → `release_payment` → balance-delta proof), and an
append-only activity timeline the mobile app reads.

- API: `POST /api/jobs`, `GET /api/jobs/:id`, `POST /api/jobs/:id/accept`,
  `POST /api/submissions`, `GET /api/submissions/:id`,
  `POST /api/verification/:submissionId`,
  `GET /api/verification/:submissionId`, `POST /api/settle`,
  `GET /api/settlements/:jobId`, `GET /api/jobs/:id/activity`,
  plus `/health` and `/api/config`. Full reference: `docs/api.md`.
- Security: verifier key lives only in `VERIFIER_KEYPAIR_PATH` (backend
  memory); API responses are secret-scanned in tests; receipts exist only
  for CONFIRMED settlements.
- Vertical slice proven on **devnet** against the deployed program
  `EmAP…` with fixed funded operator wallets: incomplete work → REJECTED
  with escrow locked; valid work → verify tx `4w19sUjjdKm6e5cKXo58AbmcqS9bcCeaL9kgpoqg8mChjoivLv8Qu3TAUVwKyaMH5uXvFnjaBVarivCa8KBZtowR`
  + release tx `JCobNVsPPuPYpqPdKf8RjfLK7MBiu22EMfkLJmos4R2k22aFVPsFK485mdNuckdMcJmEBhz5KXDF4nByz1qSjuj`,
  worker 0 → 150,000,000, escrow → 0. Artifact:
  `backend/tests/artifacts/vertical-slice.devnet.json` (localnet artifact
  alongside it).
- Docs: `docs/backend.md`, `docs/data-model.md`, `docs/attestation.md`,
  `docs/settlement.md`, `docs/api.md`.

## Security properties (enforced on-chain)

- State transitions checked against stored `job.state`; client state ignored.
- `business / worker / verifier` authorities checked against `job` record.
- Settlement signer must equal `job.verifier`; destination ATA owner must
  equal `job.worker`.
- Release only from `VERIFIED`, exactly once (`PrematureRelease` otherwise).
- No instruction lets the worker move escrow funds directly.
- Every token account mint must equal `job.usdc_mint` (`InvalidMint`).
- Escrow authority is the Job PDA; transfers use PDA-signed CPI.
- Custom errors + events on every transition.

## Out of scope (do NOT add in V1)

Marketplace, reputation, DAO, token, AI agents, GPS, complex identity,
arbitrary rule engine, multiple payment assets. Mobile UI is explicitly
deferred.
