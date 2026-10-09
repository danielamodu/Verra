# Physical-device test runbook (Seeker + devnet + backend)

Same network, no paid infra, no secrets in the app or repo.

## 1. Backend (this machine or any LAN host)

```bash
# PostgreSQL 16 running (WSL example — restart after every reboot):
/usr/lib/postgresql/16/bin/pg_ctl -D ~/pgdata -l ~/pg.log -o "-p 5433 -k /tmp" start

cd backend
npm install
npx prisma migrate deploy
PORT=4000 \
DATABASE_URL=postgresql://xbt:verra-dev-only@127.0.0.1:5433/verra \
RPC_URL=https://api.devnet.solana.com \
PROGRAM_ID=EmAPVEMNMa5vmS2GaFSjfNjg1JeWyUhy4fCe3c6PyoMp \
USDC_MINT=4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU \
VERIFIER_KEYPAIR_PATH=/home/xbt/.config/solana/verra-verifier.json \
npm run dev
```

Express `listen(PORT)` binds all interfaces — no extra flag needed. Open
the Windows firewall for inbound TCP 4000 on private networks when prompted.

## 2. LAN URL (do NOT bake localhost into the APK)

Find the host LAN IP (the Seeker must join the same Wi-Fi):

```powershell
(Get-NetIPAddress -AddressFamily IPv4 -InterfaceAlias "Wi-Fi*").IPAddress
```

Build the app with:

```bash
EXPO_PUBLIC_VERRA_API_URL=http://<LAN-IP>:4000
```

`EXPO_PUBLIC_*` values bake in at build time. The checked-in APK was built
without it (devnet mode then reports “not wired” instead of failing
silently). Never put private keys, mnemonics, or the verifier keypair in
`EXPO_PUBLIC_*`, logs, or source control — the app needs none of them.

Sanity check from the phone's network first:

```bash
curl http://<LAN-IP>:4000/health
curl http://<LAN-IP>:4000/api/config   # includes the verifier ADDRESS (public)
```

## 3. Wallets (devnet)

- Business + worker: Seeker wallet app (MWA), funded with devnet SOL
  (faucet.solana.com) and devnet USDC (Circle faucet) for the business.
- Verifier: stays in `VERIFIER_KEYPAIR_PATH` on the backend host. It never
  enters the phone, the API, the database, logs, or the APK
  (`npm run secrets-check` enforces this in CI).

## 4. The loop on device

Business: Connect → Role → Create Job (verifier auto-fills from
`/api/config`) → Fund & Publish (2 wallet approvals) → FUNDED.
Worker (second wallet or role switch): Job → Start → checklist → camera →
Review (wallet signs the submission fingerprint) → Submit → Verification
(checks + fingerprints animate) → Settlement → Settle → Verra Receipt
(real tx links) → Activity (backend-synced timeline).

Failure contrast: submit incomplete work → REJECTED with reason, no
settlement row, escrow stays locked, receipt stays in demo/pending state.

## 5. Known limitation (documented, not fixed in this phase)

If the on-chain submit transaction confirms but the following API POST is
lost to a network failure, retrying re-sends the submit transaction, which
reverts on-chain (already SUBMITTED) and blocks before POSTing. Recovery
today is operator-assisted. Wallet-cancel before sending is fully safe
(tx-first ordering).
