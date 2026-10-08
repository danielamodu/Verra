# Seeker integration — what Verra actually uses (and why)

No marketing claims. This is the complete list of Seeker/Android-specific
functionality in the app, each with the proof-related reason it exists.

## 1. Mobile Wallet Adapter — authorize + sign-and-send + signMessages

- **What:** `mobile/src/wallet/MobileWallet.ts` uses only
  `@solana-mobile/mobile-wallet-adapter-protocol-web3js` `transact()`:
  `authorize` (connect), `signAndSendTransactions` (business funds,
  worker accepts/submits), `signMessages` (worker signs the submission
  commitment).
- **Why it matters:** every signature is produced inside the user's wallet
  app after an explicit approve tap. Verra never holds keys, mnemonics, or
  signing capability — the "worker identity" in the proof chain is a wallet
  signature, not a username. Verified by `mobile/tests/wallet.test.ts`.

## 2. Seed Vault-compatible signing (no separate SDK)

- **What:** nothing beyond MWA. Seed Vault-compatible wallets expose
  authorize/sign/message-signing through the same MWA protocol, so using MWA
  IS the Seed Vault integration — keys stay in the Vault-backed wallet app.
- **Why it matters:** the verifier key and the worker key alike never enter
  the Verra process. There is no code path that could leak them because
  there is no code path that holds them (see `scripts/check-no-secrets.js`).

## 3. Device binding via Android ID

- **What:** `expo-application` `getAndroidId` feeds `device_id` into evidence
  metadata, the signed submission commitment, and the attestation. It is an
  identifier, not a key, and it is never trusted alone — it travels WITH the
  wallet signature and the content hashes.
- **Why it matters:** it completes the brief's chain —
  device → worker identity → evidence → signed submission. A submission can
  be tied to the phone that captured it, which is exactly what "the phone is
  the proof instrument" means.

## 4. Native camera (evidence collection, not verification)

- **What:** `expo-image-picker` `launchCameraAsync` — the OS camera UI.
  Photos are hashed on-device (SHA-256, shared `verification/evidence.ts`)
  and previews show the fingerprint before upload.
- **Why it matters:** native capture keeps EXIF/capture flow trustworthy
  and familiar; hashing at capture time pins bytes before any transport.
  The camera collects evidence — the engine (server-side) verifies it.

## 5. Native interaction patterns

React Navigation native stack, one primary CTA per screen, large
LOCKED/VERIFYING/VERIFIED/RELEASED states, camera permission and wallet
error states handled in-UI. No desktop tables, no settings screens.

## Explicitly NOT claimed

- No Seeker ID / Guardian staking / on-chain identity attestations.
- No background GPS/proof-of-location (out of scope by product lock).
- No custom Seed Vault API calls — there are none to make.
