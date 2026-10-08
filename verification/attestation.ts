/**
 * Verification attestation — the application-layer signed artifact.
 *
 * Built ONLY from a stored Submission plus the engine's VerificationResult
 * (never from client claims). Chain of custody:
 *
 *   device + worker identity → camera/evidence (content hashes pinned)
 *     → signed submission (worker wallet signs the attestation digest)
 *     → deterministic verification (engine)
 *     → attestation (this file)
 *     → VerifyAuthorization ticket + verifier key → verify_job (on-chain)
 *     → release_payment → settlement, referenced back into the attestation
 *       via verify_signature / release artefacts.
 *
 * The three-gate architecture is unchanged: stored submission →
 * deterministic verification → ticket → verifier key → verify_job.
 * The worker never controls the verifier key.
 */
import { ed25519 } from "@noble/curves/ed25519";
import { sha256Hex } from "./evidence";
import type { Submission, VerificationResult } from "./schema";

export interface AttestedCheck {
  requirement: string;
  passed: boolean;
  reason: string;
}

export interface AttestedEvidenceHash {
  evidence_id: string;
  requirement_id: string;
  content_hash: string;
}

export interface Attestation {
  attestation_version: 1;
  job_id: string;
  submission_id: string;
  worker: string;
  /** Per-install device identifier (e.g. Android ID) — binds proof to the phone. */
  device_id?: string;
  /** Base64 ed25519 signature by the worker wallet over the attestation digest. */
  worker_signature?: string;
  checks: AttestedCheck[];
  evidence_hashes: AttestedEvidenceHash[];
  result: "VERIFIED" | "REJECTED";
  reason: string;
  verified_at: string;
  verifier: string;
  /** verify_job transaction signature, attached after on-chain verification. */
  verify_signature?: string;
}

/** Stable JSON: sorted keys, recursive. Same value ⇒ same string, everywhere. */
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
  }
  const s = JSON.stringify(value);
  if (typeof s !== "string") throw new Error("Unserializable attestation value");
  return s;
}

function stripSignatures(att: Attestation): Record<string, unknown> {
  const { worker_signature: _w, verify_signature: _v, ...rest } = att;
  void _w;
  void _v;
  return rest as Record<string, unknown>;
}

/**
 * Digest of the attestation CONTENT (signatures excluded, so signatures
 * sign content rather than themselves). Workers sign this digest with
 * their wallet; verifiers reference it when authorizing verify_job.
 */
export function attestationDigest(att: Attestation): string {
  return sha256Hex(canonicalize(stripSignatures(att)));
}

export interface BuildAttestationInput {
  result: VerificationResult;
  submission: Submission;
  verifier: string;
  deviceId?: string;
}

/** Assemble an attestation from stored data. Pure and deterministic. */
export function buildAttestation(input: BuildAttestationInput): Attestation {
  const { result, submission, verifier, deviceId } = input;
  if (result.submission_id !== submission.submission_id) {
    throw new Error("result and submission do not match");
  }
  const att: Attestation = {
    attestation_version: 1,
    job_id: result.job_id,
    submission_id: result.submission_id,
    worker: result.worker,
    checks: result.checks.map((c) => ({
      requirement: c.requirement,
      passed: c.passed,
      reason: c.reason,
    })),
    evidence_hashes: submission.evidence.map((e) => ({
      evidence_id: e.id,
      requirement_id: e.requirement_id,
      content_hash: e.content_hash,
    })),
    result: result.status,
    reason: result.reason,
    verified_at: result.verified_at,
    verifier,
  };
  if (deviceId) att.device_id = deviceId;
  return att;
}

/** Attach the worker's wallet signature (base64) over the content digest. */
export function attachWorkerSignature(att: Attestation, signatureBase64: string): Attestation {
  if (!signatureBase64) throw new Error("Empty worker signature");
  return { ...att, worker_signature: signatureBase64 };
}

/** Attach the on-chain verify_job signature once the transaction confirms. */
export function attachVerifySignature(att: Attestation, verifySignature: string): Attestation {
  if (att.result !== "VERIFIED") {
    throw new Error("Only VERIFIED attestations can carry a verify signature");
  }
  if (!verifySignature) throw new Error("Empty verify signature");
  return { ...att, verify_signature: verifySignature };
}

/**
 * Submission commitment: the stable fingerprint the worker wallet signs.
 * Covers identity + checklist outcomes + evidence hashes only — timestamps
 * and local storage refs are excluded so the commitment is reproducible by
 * the worker, the service, and any verifier from stored data.
 */
export function submissionCommitment(sub: Pick<
  Submission,
  "job_id" | "submission_id" | "worker" | "checklist_results" | "evidence"
>): string {
  return sha256Hex(
    canonicalize({
      job_id: sub.job_id,
      submission_id: sub.submission_id,
      worker: sub.worker,
      checklist_results: sub.checklist_results,
      evidence: sub.evidence.map((e) => ({
        id: e.id,
        requirement_id: e.requirement_id,
        content_hash: e.content_hash,
      })),
    })
  );
}

function hexToBytes(hex: string): Uint8Array {
  if (!/^[0-9a-f]*$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Invalid hex");
  }
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function base58ToBytes(s: string): Uint8Array {
  const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  const bytes: number[] = [0];
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) throw new Error("Invalid base58");
    let carry = v;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

/**
 * Verify a worker's commitment signature (ed25519, base64) against the
 * recorded worker pubkey. Pure and deterministic — runs anywhere.
 */
export function verifyWorkerSignature(
  workerBase58: string,
  commitmentHex: string,
  signatureBase64: string
): boolean {
  try {
    const pubkey = base58ToBytes(workerBase58);
    if (pubkey.length !== 32) return false;
    const sig = Buffer.from(signatureBase64, "base64");
    if (sig.length !== 64) return false;
    return ed25519.verify(new Uint8Array(sig), hexToBytes(commitmentHex), pubkey);
  } catch {
    return false;
  }
}
