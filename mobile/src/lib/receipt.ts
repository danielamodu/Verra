import type { Attestation } from "../../../verification/attestation";
import { formatUSDC, truncateAddress } from "./format";

/** Pure view-model for the Verra Receipt screen (unit-tested). */
export interface ReceiptView {
  title: string;
  jobRef: string;
  workerShort: string;
  lines: { label: string; ok: boolean }[];
  amount: string;
  stateLabel: string;
  txShort: string | null;
  demo: boolean;
}

export function buildReceiptView(
  jobTitle: string,
  jobRef: string,
  attestation: Attestation,
  releaseSignature: string | null,
  amountBaseUnits: number
): ReceiptView {
  const allPassed = attestation.checks.every((c) => c.passed);
  const lines = [
    { label: "Worker verified", ok: true },
    {
      label: "Checklist complete",
      ok: attestation.checks.filter((c) => c.passed).length > 0 && allPassed,
    },
    { label: "Evidence received", ok: attestation.evidence_hashes.length > 0 },
    {
      label: "Evidence fingerprinted",
      ok:
        attestation.evidence_hashes.length > 0 &&
        attestation.evidence_hashes.every((e) => /^[0-9a-f]{64}$/.test(e.content_hash)),
    },
    { label: "Verification attested", ok: attestation.result === "VERIFIED" },
  ];
  return {
    title: jobTitle.toUpperCase(),
    jobRef,
    workerShort: truncateAddress(attestation.worker, 3),
    lines,
    amount: formatUSDC(amountBaseUnits),
    stateLabel: releaseSignature ? "SETTLED" : attestation.result,
    txShort: releaseSignature ? truncateAddress(releaseSignature, 4) : null,
    demo: releaseSignature == null,
  };
}
