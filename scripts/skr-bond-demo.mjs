/**
 * skr-bond-demo.mjs — devnet bring-up + real-chain proof for the verra_bond
 * program. Creates a CLEARLY-LABELLED MOCK SKR mint (not real SKR), configures
 * the bond program (admin-set arbiter), then performs a real stake and a real
 * arbiter slash, printing every transaction signature + explorer link and
 * writing an artifact.
 *
 * Run (inside WSL, after `anchor deploy -p verra_bond --provider.cluster devnet`):
 *   node scripts/skr-bond-demo.mjs
 *
 * Keypairs are generated once and saved under .devnet-keys/ (gitignored).
 * Optional: DEMO_RECIPIENT=<phone wallet pubkey> also mints mock SKR there so
 * you can stake from the phone during the recording.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  Connection, Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import anchorPkg from "@coral-xyz/anchor";
import {
  createMint, getOrCreateAssociatedTokenAccount, mintTo, getAccount,
  getAssociatedTokenAddress, TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";

const { AnchorProvider, BN, Program, Wallet } = anchorPkg;

const RPC = process.env.RPC_URL || "https://api.devnet.solana.com";
const SKR_DECIMALS = 9;
const UNIT = 10n ** BigInt(SKR_DECIMALS);
const MIN_BOND = 100n * UNIT;      // 100 mock SKR
const STAKE = 150n * UNIT;         // verifier stakes 150
const SLASH = 40n * UNIT;          // arbiter slashes 40
const KEYS_DIR = path.resolve(".devnet-keys");
const ROOT = path.resolve(".");

const idl = JSON.parse(fs.readFileSync(path.join(ROOT, "idl/verra_bond.json"), "utf8"));
const BOND_PROGRAM_ID = new PublicKey(process.env.BOND_PROGRAM_ID || idl.address);

const link = (sig) => `https://explorer.solana.com/tx/${sig}?cluster=devnet`;
const sol = (n) => n * LAMPORTS_PER_SOL;

function loadKeypair(file) {
  return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(file, "utf8"))));
}
function loadOrCreate(name) {
  fs.mkdirSync(KEYS_DIR, { recursive: true });
  const f = path.join(KEYS_DIR, `${name}.json`);
  if (fs.existsSync(f)) return loadKeypair(f);
  const kp = Keypair.generate();
  fs.writeFileSync(f, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

const bondPda = (verifier) =>
  PublicKey.findProgramAddressSync([Buffer.from("bond"), verifier.toBuffer()], BOND_PROGRAM_ID)[0];
const configPda = () =>
  PublicKey.findProgramAddressSync([Buffer.from("config")], BOND_PROGRAM_ID)[0];

async function ensureSol(connection, deployer, pubkey, min = 0.3) {
  const bal = await connection.getBalance(pubkey, "confirmed");
  if (bal >= sol(min)) return;
  const { Transaction } = await import("@solana/web3.js");
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  const tx = new Transaction({ blockhash, lastValidBlockHeight, feePayer: deployer.publicKey })
    .add(SystemProgram.transfer({ fromPubkey: deployer.publicKey, toPubkey: pubkey, lamports: sol(min) }));
  const sig = await connection.sendTransaction(tx, [deployer]);
  await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
}

async function readBond(program, verifier) {
  try {
    const acc = await program.account.verifierBond.fetch(bondPda(verifier));
    return { state: Object.keys(acc.state)[0], amount: BigInt(acc.amount.toString()), locked: acc.locked };
  } catch {
    return null;
  }
}

async function main() {
  const connection = new Connection(RPC, "confirmed");
  const deployer = loadKeypair(path.join(os.homedir(), ".config/solana/id.json"));
  const balance = await connection.getBalance(deployer.publicKey, "confirmed");
  console.log(`deployer ${deployer.publicKey.toBase58()} — ${(balance / LAMPORTS_PER_SOL).toFixed(3)} SOL`);
  if (balance < sol(0.5)) {
    try { await connection.requestAirdrop(deployer.publicKey, sol(2)); await new Promise((r) => setTimeout(r, 8000)); }
    catch { throw new Error("Deployer has <0.5 devnet SOL and airdrop failed. Fund it and re-run."); }
  }

  const arbiter = loadOrCreate("arbiter");
  const verifier = loadOrCreate("verifier");
  const treasury = loadOrCreate("treasury");
  await ensureSol(connection, deployer, arbiter.publicKey);
  await ensureSol(connection, deployer, verifier.publicKey);

  // Mock SKR mint (NOT real SKR). Reuse if already created.
  const mintFile = path.join(KEYS_DIR, "mock-skr.json");
  let mint;
  if (fs.existsSync(mintFile)) {
    mint = new PublicKey(JSON.parse(fs.readFileSync(mintFile, "utf8")).mint);
  } else {
    mint = await createMint(connection, deployer, deployer.publicKey, null, SKR_DECIMALS);
    fs.writeFileSync(mintFile, JSON.stringify({ mint: mint.toBase58(), label: "MOCK SKR (test) — NOT real SKR", decimals: SKR_DECIMALS }, null, 2));
  }
  console.log(`mock SKR mint (NOT real SKR): ${mint.toBase58()}`);

  const verifierAta = (await getOrCreateAssociatedTokenAccount(connection, deployer, mint, verifier.publicKey)).address;
  const treasuryAta = (await getOrCreateAssociatedTokenAccount(connection, deployer, mint, treasury.publicKey)).address;
  await mintTo(connection, deployer, mint, verifierAta, deployer, BigInt((500n * UNIT).toString()));
  if (process.env.DEMO_RECIPIENT) {
    const r = new PublicKey(process.env.DEMO_RECIPIENT);
    const rAta = (await getOrCreateAssociatedTokenAccount(connection, deployer, mint, r)).address;
    await mintTo(connection, deployer, mint, rAta, deployer, BigInt((500n * UNIT).toString()));
    console.log(`minted 500 mock SKR to DEMO_RECIPIENT ${r.toBase58()}`);
  }

  const provider = new AnchorProvider(connection, new Wallet(deployer), { commitment: "confirmed" });
  const program = new Program(idl, provider);
  const sigs = {};

  // init_config (admin = deployer; arbiter is admin-set). Idempotent.
  let cfg = null;
  try { cfg = await program.account.bondConfig.fetch(configPda()); } catch { /* not yet */ }
  if (!cfg) {
    sigs.initConfig = await program.methods
      .initConfig(arbiter.publicKey, new BN(MIN_BOND.toString()), treasury.publicKey)
      .accounts({ admin: deployer.publicKey, config: configPda(), skrMint: mint, systemProgram: SystemProgram.programId })
      .rpc();
    console.log(`init_config: ${link(sigs.initConfig)}`);
  } else {
    console.log("config already initialized — skipping init_config");
  }

  const vault = await getAssociatedTokenAddress(mint, bondPda(verifier.publicKey), true);
  const stakeAccounts = {
    verifier: verifier.publicKey, config: configPda(), bond: bondPda(verifier.publicKey),
    skrMint: mint, verifierAta, vault,
    tokenProgram: TOKEN_PROGRAM_ID, associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
  };
  sigs.stake = await program.methods.stakeBond(new BN(STAKE.toString())).accounts(stakeAccounts).signers([verifier]).rpc();
  const afterStake = await readBond(program, verifier.publicKey);
  console.log(`stake 150 mock SKR: ${link(sigs.stake)}  -> ${afterStake.state} ${afterStake.amount / UNIT}`);

  // Arbiter slashes 40 (dispute). Proves arbiter-only slashing on-chain.
  sigs.slash = await program.methods.slashBond(new BN(SLASH.toString()))
    .accounts({ arbiter: arbiter.publicKey, config: configPda(), bond: bondPda(verifier.publicKey),
      vault, treasuryAta, tokenProgram: TOKEN_PROGRAM_ID })
    .signers([arbiter]).rpc();
  const afterSlash = await readBond(program, verifier.publicKey);
  console.log(`arbiter slash 40 mock SKR: ${link(sigs.slash)}  -> ${afterSlash.state} ${afterSlash.amount / UNIT}`);

  const artifact = {
    note: "verra_bond devnet proof. SKR here is a MOCK mint — NOT real SKR.",
    cluster: "devnet", bondProgramId: BOND_PROGRAM_ID.toBase58(),
    mockSkrMint: mint.toBase58(), admin: deployer.publicKey.toBase58(),
    arbiter: arbiter.publicKey.toBase58(), verifier: verifier.publicKey.toBase58(),
    treasury: treasury.publicKey.toBase58(), minBond: MIN_BOND.toString(),
    signatures: sigs, afterStake: { ...afterStake, amount: afterStake.amount.toString() },
    afterSlash: { ...afterSlash, amount: afterSlash.amount.toString() },
    generatedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.join(ROOT, "backend/tests/artifacts"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "backend/tests/artifacts/skr-bond.devnet.json"), JSON.stringify(artifact, null, 2));
  console.log("\nartifact -> backend/tests/artifacts/skr-bond.devnet.json");
}

main().catch((e) => { console.error("FAILED:", e.message ?? e); process.exit(1); });
