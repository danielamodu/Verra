/**
 * Bond-gated verification authorization (backend-enforced).
 *
 * Before the backend issues a verify_job authorization ticket, the verifier
 * must hold an ACTIVE bond of at least the configured minimum in the
 * verra_bond program. This FAILS CLOSED: an unbonded/underbonded verifier, a
 * slashed/withdrawn bond, or any read error denies settlement — no ticket, no
 * verify_job, no release.
 *
 * This is backend policy, NOT an on-chain invariant inside proofpay (see
 * docs/skr-bond.md). The gate is active only when a bond gate is configured
 * on the Solana context; absent it, settlement behaves as the untouched
 * USDC baseline (the clean fallback).
 */
import { ApiError } from "../../api/errors";
import { logger } from "../../logger";
import type { SolanaContext } from "../../infrastructure/solana/context";

export async function ensureVerifierBonded(
  solana: SolanaContext,
  verifier: string
): Promise<void> {
  if (!solana.bond) return; // bond-gating not configured → baseline behavior
  const { minBond } = solana.bond;

  let status;
  try {
    status = await solana.bond.readBond(verifier);
  } catch (e) {
    // Fail closed: an unreadable bond is treated as no bond.
    logger.warn("bond read failed — denying settlement (fail closed)", {
      verifier,
      error: e instanceof Error ? e.message : String(e),
    });
    throw new ApiError("UNPROCESSABLE", "Verifier bond could not be verified — refusing settlement");
  }

  if (!status.active || status.amount < minBond) {
    logger.warn("verifier bond insufficient — denying authorization", {
      verifier,
      active: status.active,
      amount: status.amount.toString(),
      minBond: minBond.toString(),
    });
    throw new ApiError(
      "UNPROCESSABLE",
      `Verifier is not bonded: an active SKR bond of at least ${minBond.toString()} base units is required to authorize verification`
    );
  }
}
