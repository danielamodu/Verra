# SKR verifier bond — design, trust boundary, and mock-SKR notice

Status: Phase 5 (hackathon). Additive to the frozen `proofpay` escrow program.
`proofpay` and its USDC settlement are **unchanged**.

## Why this exists

Verra's verification is only as honest as the verifier. V1 trusts the verifier
completely: they approve work and authorize `verify_job`, with nothing at stake.
The SKR bond raises the cost of a dishonest verifier — they must post and keep
an SKR stake, and a dispute lets an arbiter **slash** it.

> Honest framing: this does **not** make verification trustless. The arbiter
> and the backend authorization check are trusted roles. The bond makes
> dishonesty *expensive*; it does not make it *impossible*. On-chain,
> trust-minimized adjudication (dispute votes, multiple independent verifiers)
> is roadmap, not shipped.

## Program: `verra_bond` (program id `fza6wCHJfcQ3DVDjPg7vmC3zJGgTQymKoN844by3qBy`)

Separate Anchor program. No CPI into or from `proofpay`.

- `BondConfig` PDA `["config"]` — admin-owned policy: `admin`, `arbiter`,
  `skr_mint`, `min_bond`, `treasury`.
- `VerifierBond` PDA `["bond", verifier]` — `verifier`, `amount`, `state`
  (None/Active/Slashed/Withdrawn), `locked`, `staked_at`.
- `vault` — ATA(`skr_mint`) owned by the `VerifierBond` PDA; holds the stake.

### Instructions & who may call them

| Instruction | Signer | Effect |
|---|---|---|
| `init_config(arbiter, min_bond, treasury)` | admin (initializer) | one-time policy; sets admin = signer |
| `set_arbiter(new)` | **admin only** | rotate arbiter; non-admin → `UnauthorizedAdmin` |
| `set_min_bond(n)` | **admin only** | adjust minimum |
| `stake_bond(amount)` | verifier | stake/top-up/re-stake; total must reach `min_bond` or revert |
| `lock_bond` / `unlock_bond` | **arbiter only** | freeze/unfreeze withdrawal during a dispute |
| `slash_bond(amount)` | **arbiter only** | move `amount` → treasury; full slash → `Slashed` |
| `withdraw_bond` | verifier | only when `Active` **and** not `locked` |

### Security properties (enforced on-chain)

- A verifier **cannot choose their own arbiter**: `arbiter` lives in the
  admin-owned `BondConfig`; `set_arbiter` requires `signer == config.admin`.
- Only `config.arbiter` can slash or lock; any other signer → `UnauthorizedArbiter`.
- Slash destination must be the configured `treasury` ATA and `skr_mint`.
- Withdrawal is blocked while `locked` (dispute unresolved / verifier still
  required) and only from `Active`.
- All transfers are PDA-signed CPI from the vault; mints are checked against
  `config.skr_mint`.

### Bond lifecycle

- **Minimum**: `config.min_bond`. A stake not reaching it reverts
  (`BelowMinimumBond`). "Active & sufficient" = `state == Active && amount >= min_bond`.
- **Partial slash**: reduces `amount`, stays `Active` (likely below minimum, so
  the verifier is no longer authorized until they top up).
- **Full slash**: drains the vault, `state → Slashed`.
- **Withdrawal**: returns the full remaining balance, `state → Withdrawn`.
- **Re-staking**: `stake_bond` works again from `Slashed` or `Withdrawn`
  (back to `Active`), and tops up an existing `Active` bond.

## Bond-gated authorization (backend-enforced)

The on-chain `verify_job` authorization in the backend settlement path
(`backend/src/domain/settlement/service.ts`) checks the verifier's bond
**before** issuing an authorization ticket. A verifier without an active,
sufficient bond is **failed closed** — no ticket, no `verify_job`, no release.

This is **backend-enforced policy, not an on-chain invariant in `proofpay`**:
`proofpay` does not (yet) CPI-check the bond. A direct on-chain invariant is
roadmap. Bond-gating activates only when the backend is configured with the
bond program id, SKR mint, and minimum (see env below); absent that config the
settlement path behaves exactly as the untouched USDC baseline — the clean
fallback demo.

### Backend env

```
BOND_PROGRAM_ID=fza6wCHJfcQ3DVDjPg7vmC3zJGgTQymKoN844by3qBy
SKR_MINT=<mock-skr-mint-address>   # see mock-SKR notice below
MIN_BOND=100000000000              # base units; must match on-chain config.min_bond
```

## Mock SKR notice — IMPORTANT

There is no verified official **devnet** SKR mint used here. For localnet tests
and any devnet demo, Verra creates a **clearly-labelled mock SKR mint** and
mints test tokens to a test wallet.

- These tokens are **NOT real SKR** and carry no value. They exist only to
  exercise the staking/slashing mechanics.
- Never represent mock-SKR balances, screenshots, or transactions as official
  SKR. Any demo UI showing the bond must label it "mock SKR (test)".
- If/when an official devnet SKR mint is verified, swap `SKR_MINT` and the
  on-chain `config.skr_mint`; no code change is required.

Localnet tests mint their own mock SKR in-harness (`tests/verra-bond.ts`).
The devnet mock mint is created by `scripts/skr-bond-demo.mjs`.

## Deployed on devnet (proven 2026-10-10)

Real artifacts — all mock SKR, never real SKR. Full artifact:
`backend/tests/artifacts/skr-bond.devnet.json`.

- Program id: `fza6wCHJfcQ3DVDjPg7vmC3zJGgTQymKoN844by3qBy`
- Deploy signature: `4ALEWCjCHWKVmsv7apHrf1aXzTeKVYFcJt55m6M7DMcCGnsmQVRSgNd6DRaQ6rmMA6KugLmaoAYdDAYkgasxDAG7`
- Upgrade authority: deployer `3jNEVjYZtMKHShfPLmS7tH8oKNngd42bU3sX7AJ1yxQD` (WSL `~/.config/solana/id.json`)
- MOCK SKR mint (NOT real SKR): `AQQatwcmW5v14uXtdKHsCKFMRt2hiNUrBUEaYg8qTFQE` (9 decimals)
- `init_config`: `3czZzpjABg59VDKeKsbHbJVMPpSR2cF4zeZddMBd4uLDXpW9nuHXJJ8ADq6vqDXs5trrUhjrFxXSKFtLvP9fLamJ`
  (admin = deployer, arbiter + treasury are separate keys under `.devnet-keys/`)
- `stake_bond` (150 mock SKR): `49Dqk3YUbBui6J1aV64eKkxPfRbtDrkbGu2ca9tTMDUUMssu5KTNiB91pnwnW9vViepFwYLG92T1srNeKr3oaMHK` → bond Active, 150
- `slash_bond` (40, arbiter): `3KR1D4RDmXe34NXajXRy6mukS6ed8VyQ9V8y6bZeeS2qCi4FC8bMMKsbRNVf9tokKqEyTrFjzHb36A3GR7zdbpD3` → bond Active, 110
- Live gate read against the deployed program: the bonded verifier reads
  `authorized=true` (active, 110 ≥ 100 min); a random unbonded key reads
  `authorized=false`.

Mobile build vars for the StakeScreen demo:

```
EXPO_PUBLIC_SKR_MINT=AQQatwcmW5v14uXtdKHsCKFMRt2hiNUrBUEaYg8qTFQE
EXPO_PUBLIC_MIN_BOND=100000000000
```

To mint mock SKR to a phone wallet for the live demo:
`DEMO_RECIPIENT=<phone pubkey> node scripts/skr-bond-demo.mjs`.
