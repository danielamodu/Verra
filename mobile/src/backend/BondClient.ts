/**
 * BondClient — standalone client for the verra_bond program (SKR verifier bond).
 *
 * Deliberately self-contained: it does NOT import SolanaBackend/LocalDemoBackend
 * or the ProofpayBackend interface, so it stays clear of files under active
 * edit. Reads are live devnet RPC; the stake transaction is signed in-wallet
 * via Mobile Wallet Adapter (Seed Vault) — this client holds no keys.
 *
 * SKR here is a LOCAL/DEVNET MOCK mint (see docs/skr-bond.md). The UI must
 * always label balances as "mock SKR (test)" — never as official SKR.
 */
import { AnchorProvider, BN, BorshAccountsCoder, Program } from "@coral-xyz/anchor";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import bondIdl from "../../../idl/verra_bond.json";

export const DEVNET_RPC = "https://api.devnet.solana.com";
export const BOND_PROGRAM_ID = new PublicKey("fza6wCHJfcQ3DVDjPg7vmC3zJGgTQymKoN844by3qBy");
/** Mock SKR has 9 decimals in the test/devnet setup. */
export const SKR_DECIMALS = 9;

const env = (k: string): string =>
  (typeof process !== "undefined" && (process as any).env?.[k]) || "";

/** Mock SKR mint address — injected at build time; empty until configured. */
export function skrMint(): string {
  return env("EXPO_PUBLIC_SKR_MINT");
}
/** Minimum bond (base units) for the "bonded" badge; display only. */
export function minBondBaseUnits(): bigint {
  const v = env("EXPO_PUBLIC_MIN_BOND");
  return v ? BigInt(v) : 0n;
}

export interface BondView {
  exists: boolean;
  active: boolean;
  locked: boolean;
  amount: bigint;
  /** True when active and at or above the configured minimum. */
  sufficient: boolean;
}

const coder = new BorshAccountsCoder(bondIdl as any);

export class BondClient {
  private connection: Connection;
  constructor(rpcUrl: string = DEVNET_RPC) {
    this.connection = new Connection(rpcUrl, "confirmed");
  }

  static bondPda(verifier: PublicKey): PublicKey {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("bond"), verifier.toBuffer()],
      BOND_PROGRAM_ID
    )[0];
  }

  /** Live read of a verifier's bond. Returns a non-existent bond gracefully. */
  async readBond(verifier: string): Promise<BondView> {
    const pda = BondClient.bondPda(new PublicKey(verifier));
    const info = await this.connection.getAccountInfo(pda, "confirmed");
    if (!info) return { exists: false, active: false, locked: false, amount: 0n, sufficient: false };
    const acc: any = coder.decode("VerifierBond", info.data);
    // Normalize enum casing: coder.decode yields IDL names ("Active").
    const stateKey = acc?.state ? Object.keys(acc.state)[0] : undefined;
    const amount = BigInt(acc?.amount?.toString?.() ?? "0");
    const active = String(stateKey).toLowerCase() === "active";
    const min = minBondBaseUnits();
    return {
      exists: true,
      active,
      locked: Boolean(acc?.locked),
      amount,
      sufficient: active && amount >= min,
    };
  }

  /**
   * Stake `amountBaseUnits` of mock SKR. The verifier approves an authorize +
   * sign-and-send in their wallet (Seed Vault). Returns the confirmed sig.
   */
  async stake(verifier: string, amountBaseUnits: bigint): Promise<string> {
    const mint = skrMint();
    if (!mint) throw new Error("SKR mint not configured (set EXPO_PUBLIC_SKR_MINT).");
    const verifierPk = new PublicKey(verifier);
    const skrMintPk = new PublicKey(mint);
    const bondPda = BondClient.bondPda(verifierPk);
    const [verifierAta, vault] = await Promise.all([
      getAssociatedTokenAddress(skrMintPk, verifierPk),
      getAssociatedTokenAddress(skrMintPk, bondPda, true),
    ]);

    const provider = new AnchorProvider(
      this.connection,
      { publicKey: verifierPk } as any,
      { commitment: "confirmed" }
    );
    const program = new Program(bondIdl as any, provider);
    const tx: Transaction = await program.methods
      .stakeBond(new BN(amountBaseUnits.toString()))
      .accounts({
        verifier: verifierPk,
        config: PublicKey.findProgramAddressSync([Buffer.from("config")], BOND_PROGRAM_ID)[0],
        bond: bondPda,
        skrMint: skrMintPk,
        verifierAta,
        vault,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      })
      .transaction();

    const { blockhash, lastValidBlockHeight } = await this.connection.getLatestBlockhash("confirmed");
    tx.recentBlockhash = blockhash;
    tx.feePayer = verifierPk;

    const signature: string = await transact(async (wallet: any) => {
      await wallet.authorize({ identity: { name: "Verra", uri: "https://verra.app" }, chain: "solana:devnet" });
      const res = await wallet.signAndSendTransactions({ transactions: [tx] });
      const sig = res?.signatures?.[0] ?? res?.[0];
      if (typeof sig !== "string" || !sig) throw new Error("Wallet did not return a signature.");
      return sig;
    });
    await this.connection.confirmTransaction({ signature, blockhash, lastValidBlockHeight }, "confirmed");
    return signature;
  }
}

/** Format base units as a human mock-SKR amount (never labelled as real SKR). */
export function formatSkr(baseUnits: bigint): string {
  const d = BigInt(10) ** BigInt(SKR_DECIMALS);
  const whole = baseUnits / d;
  const frac = (baseUnits % d).toString().padStart(SKR_DECIMALS, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}
