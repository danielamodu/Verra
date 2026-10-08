/** Attestation unit tests — no validator required. */
import { assert } from "chai";
import bs58 from "bs58";
import { ed25519 } from "@noble/curves/ed25519";
import {
  attachVerifySignature,
  attachWorkerSignature,
  attestationDigest,
  buildAttestation,
  canonicalize,
  submissionCommitment,
  verifyWorkerSignature,
} from "../verification/attestation";
import { validStoreSubmission } from "../verification/example-job";
import { verifySubmission } from "../verification/engine";
import { storeInspectionRequirements } from "../verification/example-job";

const JOB = "42";
const WORKER = "Worker111111111111111111111111111111111111111";
const VERIFIER = "Verifier1111111111111111111111111111111111111";
const SUBMITTED_AT = "2026-01-15T12:00:00.000Z";
const NOW = Date.parse(SUBMITTED_AT) + 1000;

function verifiedResult() {
  const sub = validStoreSubmission({
    jobId: JOB,
    worker: WORKER,
    submissionId: "att-sub-1",
    submittedAt: SUBMITTED_AT,
  });
  const result = verifySubmission({
    requirements: storeInspectionRequirements(),
    submission: sub,
    expectedJobId: JOB,
    expectedWorker: WORKER,
    now: NOW,
  });
  assert.equal(result.status, "VERIFIED");
  return { sub, result };
}

describe("attestation", () => {
  it("builds the full artifact from stored submission + result", () => {
    const { sub, result } = verifiedResult();
    const att = buildAttestation({
      result,
      submission: sub,
      verifier: VERIFIER,
      deviceId: "android-id-123",
    });
    assert.equal(att.attestation_version, 1);
    assert.equal(att.job_id, JOB);
    assert.equal(att.submission_id, "att-sub-1");
    assert.equal(att.worker, WORKER);
    assert.equal(att.verifier, VERIFIER);
    assert.equal(att.device_id, "android-id-123");
    assert.equal(att.result, "VERIFIED");
    assert.lengthOf(att.checks, 2);
    assert.isTrue(att.checks.every((c) => c.passed));
    assert.lengthOf(att.evidence_hashes, 10);
    assert.isTrue(
      att.evidence_hashes.every((e) => /^[0-9a-f]{64}$/.test(e.content_hash))
    );
    assert.isUndefined(att.worker_signature);
    assert.isUndefined(att.verify_signature);
  });

  it("digest is deterministic", () => {
    const { sub, result } = verifiedResult();
    const a = buildAttestation({ result, submission: sub, verifier: VERIFIER });
    const b = buildAttestation({
      result: JSON.parse(JSON.stringify(result)),
      submission: JSON.parse(JSON.stringify(sub)),
      verifier: VERIFIER,
    });
    assert.equal(attestationDigest(a), attestationDigest(b));
  });

  it("any tampering changes the digest", () => {
    const { sub, result } = verifiedResult();
    const a = buildAttestation({ result, submission: sub, verifier: VERIFIER });
    const tampered = {
      ...a,
      checks: a.checks.map((c) => ({ ...c, reason: c.reason + "!" })),
    };
    assert.notEqual(attestationDigest(a), attestationDigest(tampered));
  });

  it("signatures attach without changing the content digest", () => {
    const { sub, result } = verifiedResult();
    const a = buildAttestation({ result, submission: sub, verifier: VERIFIER });
    const before = attestationDigest(a);
    const signed = attachWorkerSignature(attachVerifySignature(a, "verify-sig-abc"), "worker-sig-xyz");
    assert.equal(signed.worker_signature, "worker-sig-xyz");
    assert.equal(signed.verify_signature, "verify-sig-abc");
    assert.equal(attestationDigest(signed), before);
  });

  it("verify signature requires VERIFIED", () => {
    const { sub, result } = verifiedResult();
    const rejected = buildAttestation({
      result: { ...result, status: "REJECTED", reason: "nope" },
      submission: sub,
      verifier: VERIFIER,
    });
    assert.throws(() => attachVerifySignature(rejected, "sig"), /Only VERIFIED/);
  });

  it("canonicalize is key-order independent", () => {
    assert.equal(canonicalize({ b: 1, a: 2 }), canonicalize({ a: 2, b: 1 }));
  });

  it("worker commitment sign/verify round-trip (ephemeral key, never stored)", () => {
    const { sub } = verifiedResult();
    const commitment = submissionCommitment(sub);
    assert.match(commitment, /^[0-9a-f]{64}$/);
    const priv = ed25519.utils.randomPrivateKey();
    const pub = ed25519.getPublicKey(priv);
    const worker58 = bs58.encode(pub);
    const sig = ed25519.sign(Buffer.from(commitment, "hex"), priv);
    const sigB64 = Buffer.from(sig).toString("base64");
    assert.isTrue(verifyWorkerSignature(worker58, commitment, sigB64));
    // Tampered signature fails.
    const bad = Buffer.from(sig);
    bad[0] ^= 0xff;
    assert.isFalse(verifyWorkerSignature(worker58, commitment, Buffer.from(bad).toString("base64")));
    // Wrong worker fails.
    const other58 = bs58.encode(ed25519.getPublicKey(ed25519.utils.randomPrivateKey()));
    assert.isFalse(verifyWorkerSignature(other58, commitment, sigB64));
  });
});
