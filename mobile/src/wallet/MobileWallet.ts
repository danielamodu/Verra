/**
 * Mobile Wallet Adapter wrapper (Seeker / Seed Vault compatible).
 *
 * Signing always happens inside the user's wallet app via MWA `transact`.
 * This module holds NO keys, NO mnemonics, and creates NO keypairs — it only
 * brokers authorization sessions. On devices without an MWA wallet, every
 * method throws WalletUnavailableError with a human-readable message.
 *
 * Seed Vault note: Seed Vault-compatible wallets expose signing through the
 * same MWA protocol (authorize / signTransactions / signMessages). There is
 * no separate Seed Vault SDK call to make — using MWA IS the Seed Vault
 * integration. See docs/seeker.md.
 */
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";

export const DEVNET_CHAIN = "solana:devnet";
const APP_IDENTITY = { name: "Verra", uri: "https://verra.app" };

export class WalletUnavailableError extends Error {
  constructor(message = "No Solana wallet found. Install a Mobile Wallet Adapter wallet (e.g. on Seeker) and try again.") {
    super(message);
    this.name = "WalletUnavailableError";
  }
}

export interface WalletSession {
  address: string;
  authToken: string;
}

/** Authorize with the wallet app (user approves in-wallet). */
export async function connectWallet(): Promise<WalletSession> {
  try {
    const result: any = await transact(async (wallet: any) => {
      return wallet.authorize({
        identity: APP_IDENTITY,
        chain: DEVNET_CHAIN,
      });
    });
    const account = result?.accounts?.[0];
    const address: string | undefined =
      typeof account?.address === "string" ? account.address : account?.publicKey?.toBase58?.();
    if (!address) throw new WalletUnavailableError("Wallet did not return an account.");
    return { address, authToken: String(result.authToken ?? "") };
  } catch (e: any) {
    if (e instanceof WalletUnavailableError) throw e;
    throw new WalletUnavailableError(
      e?.message ? `Wallet connection failed: ${e.message}` : undefined
    );
  }
}

/** End the authorization session. Never throws — best effort. */
export async function disconnectWallet(authToken: string): Promise<void> {
  try {
    await transact(async (wallet: any) => {
      if (authToken) await wallet.deauthorize({ authToken });
    });
  } catch {
    // Best effort: session expiry server-side is harmless.
  }
}

/**
 * Ask the wallet to sign an opaque payload (e.g. an attestation digest).
 * Used for worker submission signatures — the wallet app (Seed Vault)
 * performs the ed25519 signature; raw key material never leaves it.
 * Returns the raw signature bytes.
 */
export async function signDigest(authToken: string, digest: Uint8Array): Promise<Uint8Array> {
  try {
    const result: any = await transact(async (wallet: any) => {
      if (typeof wallet.signMessages !== "function") {
        throw new Error("Wallet does not support message signing.");
      }
      return wallet.signMessages({
        payloads: [digest],
        ...(authToken ? { authToken } : {}),
      });
    });
    const signed = result?.signedPayloads?.[0] ?? result?.signatures?.[0];
    const bytes: number[] | undefined =
      signed instanceof Uint8Array ? Array.from(signed) : signed;
    if (!bytes || bytes.length === 0) {
      throw new Error("Wallet returned an empty signature.");
    }
    return Uint8Array.from(bytes);
  } catch (e: any) {
    throw new WalletUnavailableError(
      e?.message ? `Signing failed: ${e.message}` : "Signing failed."
    );
  }
}
