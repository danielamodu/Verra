# Mobile app — Verra (Expo + React Native + TypeScript)

Stack: **Expo SDK 52 (RN 0.76, TypeScript) + React Navigation + Solana
Mobile Wallet Adapter + expo-image-picker + expo-application.** Chosen
because it is TypeScript end-to-end (reuses `verification/` engine, schema,
attestation directly — zero duplicated protocol logic), MWA is the
Seeker-endorsed signing path (Seed Vault works through it), and Expo
prebuild produces a standard Gradle project for the APK.

```
mobile/                  # Expo project (package: app.verra.mobile)
  App.tsx                # polyfills → WalletProvider → ProofpayProvider → navigator
  src/theme.ts           # one palette + LOCKED/VERIFYING/VERIFIED/RELEASED colors
  src/lib/               # format, base64, encoding, status, receipt (pure, tested)
  src/wallet/            # MWA wrapper (no keys, ever) + WalletContext (role, deviceId)
  src/backend/           # ProofpayBackend interface
    LocalDemoBackend.ts  # honest demo: REAL engine, receipts always real:false
    SolanaBackend.ts     # REAL devnet tx builders (MWA-signed) + API settlement
  src/state/             # ProofpayContext (backend switch demo/devnet)
  src/navigation/        # 13-route native stack (Connect→Role→…→Receipt)
  src/screens/           # Connect, Role, BusinessHome, CreateJob, WorkerHome,
                         # JobDetail, ExecuteJob, Evidence, Review,
                         # Verification, Settlement, Receipt, Activity
  src/components/        # Screen, PrimaryButton, StatusBadge, JobCard
  tests/                 # jest (UI-safe) + ts-mocha (chain-touching)
  scripts/check-no-secrets.js
```

## Backend switching

- Default: `LocalDemoBackend` — full loop with the real engine; settlement
  receipts are `real: false` and the UI says so.
- Devnet: Connect screen → “Use devnet backend”. Requires a funded devnet
  wallet (SOL + USDC) and, for verify/settle, `EXPO_PUBLIC_VERRA_API_URL`
  pointing at the Verra backend API (operator holds the verifier key).

## Wiring the real backend (remaining work)

1. `SolanaBackend` tx builders are implemented (create/fund/accept/submit
   via Anchor + MWA sign-and-send). They execute on-device once wallets are
   funded.
2. Stand up the Verra backend API (thin wrapper around Phase 2
   `VerificationService` + `verifyAndSettle` from `verification/onchain.ts`):
   - `POST /api/submissions` → persist + return `VerificationResult`
   - `GET /api/submissions/:jobId` → stored submission (fingerprints UI)
   - `POST /api/settle { jobId }` → `{ verifySignature, releaseSignature }`
3. Set `EXPO_PUBLIC_VERRA_API_URL` in the app build.
4. No indexer yet: `listJobs`/`getJob` on SolanaBackend are session-scoped
   (jobs created in-session). Production needs an indexer or backend job feed.

## Commands

```bash
cd mobile
npm install
npm run typecheck   # tsc --noEmit
npm test            # jest (20) + ts-mocha chain tests (5)
npm run secrets-check
npx expo prebuild --platform android --no-install
./android/gradlew -p android assembleDebug   # needs JDK 17 + SDK 34 + NDK 26
```

## Test-only module mapping (jest)

`@solana/web3.js` pulls ESM-only transitive deps (`jayson`, `uuid`) that
jest cannot parse. Chain-touching tests run under ts-mocha (plain Node)
instead — see `"test"` script. Metro/RN bundles are unaffected.

## Note: `expo export` vs `assembleDebug`

`npx expo export` fails resolving the
`@solana-mobile/mobile-wallet-adapter-protocol/encoding` subpath (its
`exports` map has no fallback Metro 0.80 accepts in the export path).
The supported APK path (`expo prebuild` + `assembleDebug`) bundles the
same graph successfully — that is what ships. No code change needed;
revisit only if the export path becomes required.
