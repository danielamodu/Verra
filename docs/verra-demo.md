# Verra demo script (hackathon) — happy path + failure contrast

Runs fully in demo mode (no wallet, no funds). Every step maps to a screen.

## Happy path — $150 LOCKED → $150 PAID (receipt)

1. **Connect** → “Continue without wallet (demo)” → **Role** → BUSINESS.
2. **Business Home** → Create Job → title “Inspect 10 stores”, amount 150,
   worker = any address → **Fund & Publish** → Job lands FUNDED.
3. Back out, switch role (Role screen) → WORKER → open the job:
   `0/10 complete, 0/3 photos`, status FUNDED → **Start job**.
4. **Checklist** → tick all → **Capture evidence** → take 3 photos
   (each shows its ⛓ fingerprint) → **Review submission**
   (CHECKLIST ✓ / EVIDENCE ✓ / WORKER ✓) → **Submit work**.
5. **Verification** animates Submitted → Checking requirements (per-check
   ✓ rows + evidence fingerprints) → **VERIFIED**.
6. **Settlement** → **Settle** → **Verra Receipt**: STORE INSPECTION,
   worker short address, five ✓ lines, $150, demo badge (honest: no chain tx
   in demo mode).

## Failure contrast — $150 stays locked

1. Same job (or a new one) → as worker, complete only SOME checklist items…
   (the UI gates submit until complete — to force the contrast, submit via
   the engine path with `completed: false`, or use a fresh job and submit
   with 0 photos by temporarily lowering `minPhotos`).
   Simplest scripted route: run `npm test` in `mobile/` — the
   “invalid evidence → REJECTED” case proves: REJECTED verdict,
   `releasePayment` refuses (`Only VERIFIED…`), chain state stays REJECTED,
   funds locked.
2. On-device: after a rejection, Verification shows REJECTED + reason, and
   offers **Fix and resubmit** (REJECTED → IN_PROGRESS on-chain loop).

## Real-money variant (devnet, when funded)

1. Fund the phone wallet with devnet SOL + USDC (Circle faucet).
2. Connect screen → **Use devnet backend** → connect wallet → role BUSINESS.
3. Create job with a real worker + the Verra verifier address → approve two
   wallet transactions (create + fund). USDC really locks in escrow.
4. Worker flow on a second wallet approves accept + submit (evidence also
   POSTs to `EXPO_PUBLIC_VERRA_API_URL`).
5. Operator (laptop, verifier key): verify + release via
   `verifyAndSettle` (`verification/onchain.ts`) or the backend API.
6. Receipt shows both real signatures + explorer links; worker +$150 USDC.
