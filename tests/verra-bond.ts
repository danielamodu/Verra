/**
 * verra_bond — localnet test suite.
 *
 * Proves the SKR verifier-bond lifecycle and its security properties:
 *   - admin-configured arbiter (a verifier can NEVER set their own arbiter)
 *   - stake must reach the configured minimum
 *   - only the configured arbiter can slash or lock; partial + full slash
 *   - withdrawal blocked while locked; allowed after unlock
 *   - re-staking after withdrawal or slashing
 *
 * The SKR mint here is a LOCAL MOCK (createMint in this harness). It is NOT
 * real SKR and never leaves localnet. See docs/skr-bond.md.
 */
import * as anchor from "@coral-xyz/anchor";
import { BN } from "@coral-xyz/anchor";
import {
  createMint,
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  getAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Keypair, PublicKey, SystemProgram, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { assert } from "chai";

/** Mock SKR: 9 decimals. 1 SKR = 1_000_000_000 base units. NOT real SKR. */
const SKR_DECIMALS = 9;
const SKR = (n: number) => new BN(n).mul(new BN(10).pow(new BN(SKR_DECIMALS)));
const MIN_BOND = SKR(100); // 100 mock SKR

describe("verra_bond", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program: any = anchor.workspace.VerraBond;
  const connection = provider.connection;
  const payer = (provider.wallet as anchor.Wallet).payer;

  let skrMint: PublicKey;
  const admin = payer; // provider wallet is the admin/config initializer
  const arbiter = Keypair.generate();
  const verifier = Keypair.generate();
  const treasury = Keypair.generate();
  const stranger = Keypair.generate();

  let configPda: PublicKey;
  let verifierAta: PublicKey;
  let treasuryAta: PublicKey;

  const bondPda = (v: PublicKey) =>
    PublicKey.findProgramAddressSync([Buffer.from("bond"), v.toBuffer()], program.programId)[0];
  const vaultFor = (v: PublicKey) =>
    getAssociatedTokenAddress(skrMint, bondPda(v), true);

  async function fund(pk: PublicKey, sol = 2) {
    const sig = await connection.requestAirdrop(pk, sol * LAMPORTS_PER_SOL);
    await connection.confirmTransaction(sig, "confirmed");
  }
  const bondState = (s: any): string => Object.keys(s)[0];

  before(async () => {
    await fund(payer.publicKey, 10);
    await Promise.all([fund(arbiter.publicKey), fund(verifier.publicKey), fund(stranger.publicKey)]);
    [configPda] = PublicKey.findProgramAddressSync([Buffer.from("config")], program.programId);
    // Mock SKR mint — mint authority is the test payer.
    skrMint = await createMint(connection, payer, payer.publicKey, null, SKR_DECIMALS);
    verifierAta = (
      await getOrCreateAssociatedTokenAccount(connection, payer, skrMint, verifier.publicKey)
    ).address;
    treasuryAta = (
      await getOrCreateAssociatedTokenAccount(connection, payer, skrMint, treasury.publicKey)
    ).address;
    // Give the verifier 500 mock SKR to work with.
    await mintTo(connection, payer, skrMint, verifierAta, payer, BigInt(SKR(500).toString()));
  });

  let vault: PublicKey;

  async function expectError(p: Promise<any>, code: string) {
    try {
      await p;
      assert.fail(`expected error ${code} but call succeeded`);
    } catch (e: any) {
      assert.include(e.toString(), code, `expected ${code}, got: ${e}`);
    }
  }

  it("initializes config with an admin-set arbiter", async () => {
    vault = await vaultFor(verifier.publicKey);
    await program.methods
      .initConfig(arbiter.publicKey, MIN_BOND, treasury.publicKey)
      .accounts({ admin: admin.publicKey, config: configPda, skrMint, systemProgram: SystemProgram.programId })
      .rpc();
    const cfg = await program.account.bondConfig.fetch(configPda);
    assert.equal(cfg.admin.toBase58(), admin.publicKey.toBase58());
    assert.equal(cfg.arbiter.toBase58(), arbiter.publicKey.toBase58());
    assert.equal(cfg.skrMint.toBase58(), skrMint.toBase58());
    assert.equal(cfg.minBond.toString(), MIN_BOND.toString());
  });

  it("rejects a verifier (non-admin) trying to set the arbiter", async () => {
    await expectError(
      program.methods
        .setArbiter(verifier.publicKey)
        .accounts({ admin: verifier.publicKey, config: configPda })
        .signers([verifier])
        .rpc(),
      "UnauthorizedAdmin"
    );
  });

  it("lets the admin rotate the arbiter and back", async () => {
    const tmp = Keypair.generate();
    await program.methods.setArbiter(tmp.publicKey).accounts({ admin: admin.publicKey, config: configPda }).rpc();
    let cfg = await program.account.bondConfig.fetch(configPda);
    assert.equal(cfg.arbiter.toBase58(), tmp.publicKey.toBase58());
    await program.methods.setArbiter(arbiter.publicKey).accounts({ admin: admin.publicKey, config: configPda }).rpc();
    cfg = await program.account.bondConfig.fetch(configPda);
    assert.equal(cfg.arbiter.toBase58(), arbiter.publicKey.toBase58());
  });

  const stakeAccounts = () => ({
    verifier: verifier.publicKey,
    config: configPda,
    bond: bondPda(verifier.publicKey),
    skrMint,
    verifierAta,
    vault,
    tokenProgram: TOKEN_PROGRAM_ID,
    associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
    systemProgram: SystemProgram.programId,
  });

  it("rejects a stake below the minimum", async () => {
    await expectError(
      program.methods.stakeBond(SKR(50)).accounts(stakeAccounts()).signers([verifier]).rpc(),
      "BelowMinimumBond"
    );
  });

  it("accepts a sufficient stake and marks the bond Active", async () => {
    await program.methods.stakeBond(SKR(150)).accounts(stakeAccounts()).signers([verifier]).rpc();
    const bond = await program.account.verifierBond.fetch(bondPda(verifier.publicKey));
    assert.equal(bondState(bond.state), "active");
    assert.equal(bond.amount.toString(), SKR(150).toString());
    const v = await getAccount(connection, vault);
    assert.equal(v.amount.toString(), SKR(150).toString());
  });

  it("rejects a slash from a non-arbiter", async () => {
    await expectError(
      program.methods
        .slashBond(SKR(10))
        .accounts({ arbiter: stranger.publicKey, config: configPda, bond: bondPda(verifier.publicKey), vault, treasuryAta, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([stranger])
        .rpc(),
      "UnauthorizedArbiter"
    );
  });

  it("blocks withdrawal while the arbiter has locked the bond", async () => {
    await program.methods
      .lockBond()
      .accounts({ arbiter: arbiter.publicKey, config: configPda, bond: bondPda(verifier.publicKey) })
      .signers([arbiter])
      .rpc();
    await expectError(
      program.methods
        .withdrawBond()
        .accounts({ verifier: verifier.publicKey, config: configPda, bond: bondPda(verifier.publicKey), vault, verifierAta, tokenProgram: TOKEN_PROGRAM_ID })
        .signers([verifier])
        .rpc(),
      "BondLocked"
    );
  });

  it("partial-slashes via the arbiter (bond stays Active)", async () => {
    await program.methods
      .slashBond(SKR(40))
      .accounts({ arbiter: arbiter.publicKey, config: configPda, bond: bondPda(verifier.publicKey), vault, treasuryAta, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([arbiter])
      .rpc();
    const bond = await program.account.verifierBond.fetch(bondPda(verifier.publicKey));
    assert.equal(bondState(bond.state), "active");
    assert.equal(bond.amount.toString(), SKR(110).toString());
    const t = await getAccount(connection, treasuryAta);
    assert.equal(t.amount.toString(), SKR(40).toString());
  });

  it("unlocks and lets the verifier withdraw the remainder", async () => {
    await program.methods
      .unlockBond()
      .accounts({ arbiter: arbiter.publicKey, config: configPda, bond: bondPda(verifier.publicKey) })
      .signers([arbiter])
      .rpc();
    await program.methods
      .withdrawBond()
      .accounts({ verifier: verifier.publicKey, config: configPda, bond: bondPda(verifier.publicKey), vault, verifierAta, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([verifier])
      .rpc();
    const bond = await program.account.verifierBond.fetch(bondPda(verifier.publicKey));
    assert.equal(bondState(bond.state), "withdrawn");
    assert.equal(bond.amount.toString(), "0");
    const v = await getAccount(connection, vault);
    assert.equal(v.amount.toString(), "0");
  });

  it("re-stakes after withdrawal", async () => {
    await program.methods.stakeBond(SKR(120)).accounts(stakeAccounts()).signers([verifier]).rpc();
    const bond = await program.account.verifierBond.fetch(bondPda(verifier.publicKey));
    assert.equal(bondState(bond.state), "active");
    assert.equal(bond.amount.toString(), SKR(120).toString());
  });

  it("full-slashes to Slashed, then allows re-staking", async () => {
    await program.methods
      .slashBond(SKR(120))
      .accounts({ arbiter: arbiter.publicKey, config: configPda, bond: bondPda(verifier.publicKey), vault, treasuryAta, tokenProgram: TOKEN_PROGRAM_ID })
      .signers([arbiter])
      .rpc();
    let bond = await program.account.verifierBond.fetch(bondPda(verifier.publicKey));
    assert.equal(bondState(bond.state), "slashed");
    assert.equal(bond.amount.toString(), "0");

    await program.methods.stakeBond(SKR(100)).accounts(stakeAccounts()).signers([verifier]).rpc();
    bond = await program.account.verifierBond.fetch(bondPda(verifier.publicKey));
    assert.equal(bondState(bond.state), "active");
    assert.equal(bond.amount.toString(), SKR(100).toString());
  });
});
