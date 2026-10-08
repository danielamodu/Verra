/**
 * Verification engine unit tests — no validator required.
 * Covers every rule in verification/engine.ts deterministically
 * (fixed clock, fixed fixtures).
 */
import { assert } from "chai";
import {
  sha256Hex,
  verifyEvidenceContent,
  verifySubmission,
  VerificationService,
  photoEvidence,
  type Evidence,
  type Requirement,
  type Submission,
} from "../verification";

const JOB = "42";
const WORKER = "Worker111111111111111111111111111111111111111";
const VERIFIER = "Verifier1111111111111111111111111111111111111";
const SUBMITTED_AT = "2026-01-15T12:00:00.000Z";
const CAPTURED_AT = "2026-01-15T11:00:00.000Z";
const NOW = Date.parse(SUBMITTED_AT) + 1000;

const CHECK_ONLY: Requirement[] = [
  {
    id: "checklist",
    type: "CHECKLIST",
    label: "Checklist",
    required: true,
    configuration: {
      items: [
        { id: "a", label: "Item A" },
        { id: "b", label: "Item B" },
      ],
    },
  },
];

const PHOTOS_ONLY: Requirement[] = [
  {
    id: "photos",
    type: "PHOTO_EVIDENCE",
    label: "Photos",
    required: true,
    configuration: { minPhotos: 2 },
  },
];

const BOTH: Requirement[] = [...CHECK_ONLY, ...PHOTOS_ONLY];

function baseSubmission(): Submission {
  return {
    job_id: JOB,
    worker: WORKER,
    submitted_at: SUBMITTED_AT,
    submission_id: "sub-1",
    checklist_results: [],
    evidence: [],
  };
}

function photo(id: string, reqId = "photos"): Evidence {
  return photoEvidence(id, reqId, "store-01", `bytes-for-${id}`, CAPTURED_AT);
}

function run(reqs: Requirement[], sub: unknown) {
  return verifySubmission({
    requirements: reqs,
    submission: sub,
    expectedJobId: JOB,
    expectedWorker: WORKER,
    now: NOW,
  });
}

describe("verification engine (offline)", () => {
  it("valid checklist", () => {
    const sub = { ...baseSubmission(), checklist_results: [{ requirement_id: "checklist", completed: true }] };
    const r = run(CHECK_ONLY, sub);
    assert.equal(r.status, "VERIFIED");
    assert.lengthOf(r.checks, 1);
    assert.isTrue(r.checks[0].passed);
  });

  it("incomplete checklist", () => {
    const sub = { ...baseSubmission(), checklist_results: [{ requirement_id: "checklist", completed: false }] };
    const r = run(CHECK_ONLY, sub);
    assert.equal(r.status, "REJECTED");
    assert.match(r.reason, /incomplete checklist/);
  });

  it("missing checklist", () => {
    const r = run(CHECK_ONLY, baseSubmission());
    assert.equal(r.status, "REJECTED");
    assert.match(r.reason, /missing result/);
  });

  it("valid photo evidence", () => {
    const sub = { ...baseSubmission(), evidence: [photo("e1"), photo("e2")] };
    const r = run(PHOTOS_ONLY, sub);
    assert.equal(r.status, "VERIFIED");
    assert.isTrue(r.checks[0].passed);
  });

  it("missing photo", () => {
    const r = run(PHOTOS_ONLY, baseSubmission());
    assert.equal(r.status, "REJECTED");
    assert.match(r.reason, /missing evidence/);
  });

  it("insufficient photos", () => {
    const sub = { ...baseSubmission(), evidence: [photo("e1")] };
    const r = run(PHOTOS_ONLY, sub);
    assert.equal(r.status, "REJECTED");
    assert.match(r.reason, /found 1 photo\(s\), require at least 2/);
  });

  it("wrong worker", () => {
    const sub = {
      ...baseSubmission(),
      worker: "Attacker11111111111111111111111111111111111111",
      checklist_results: [{ requirement_id: "checklist", completed: true }],
    };
    const r = run(CHECK_ONLY, sub);
    assert.equal(r.status, "REJECTED");
    assert.match(r.reason, /wrong worker/);
  });

  it("wrong job", () => {
    const sub = {
      ...baseSubmission(),
      job_id: "999",
      checklist_results: [{ requirement_id: "checklist", completed: true }],
    };
    const r = run(CHECK_ONLY, sub);
    assert.equal(r.status, "REJECTED");
    assert.match(r.reason, /wrong job/);
  });

  it("malformed submission", () => {
    // Not an object.
    assert.equal(run(CHECK_ONLY, "verified: true").status, "REJECTED");
    // Wrong field types.
    assert.equal(
      run(CHECK_ONLY, { ...baseSubmission(), checklist_results: "yes" }).status,
      "REJECTED"
    );
    // Bad content hash.
    const badHash = {
      ...baseSubmission(),
      evidence: [{ ...photo("e1"), content_hash: "not-a-hash" }],
    };
    const r1 = run(PHOTOS_ONLY, badHash);
    assert.equal(r1.status, "REJECTED");
    assert.match(r1.reason, /content_hash/);
    // Unknown requirement reference.
    const unknownRef = {
      ...baseSubmission(),
      checklist_results: [{ requirement_id: "nope", completed: true }],
    };
    const r2 = run(CHECK_ONLY, unknownRef);
    assert.equal(r2.status, "REJECTED");
    assert.match(r2.reason, /unknown requirement/);
  });

  it("valid complete submission → VERIFIED (+ authorizes on-chain verify)", () => {
    const svc = new VerificationService({
      jobId: JOB,
      worker: WORKER,
      verifier: VERIFIER,
      requirements: BOTH,
      clock: () => NOW,
    });
    const sub: Submission = {
      ...baseSubmission(),
      submission_id: "sub-complete",
      checklist_results: [{ requirement_id: "checklist", completed: true }],
      evidence: [photo("e1"), photo("e2")],
    };
    const r = svc.submit(sub);
    assert.equal(r.status, "VERIFIED");
    assert.lengthOf(r.checks, 2);
    assert.isTrue(r.checks.every((c) => c.passed));
    // Persisted for audit.
    assert.deepEqual(svc.getSubmission("sub-complete"), sub);
    assert.deepEqual(svc.getResult("sub-complete"), r);
    // VERIFIED yields the server-side authorization ticket.
    const ticket = svc.authorizeOnChainVerify(r);
    assert.equal(ticket.verifier, VERIFIER);
    assert.equal(ticket.submission_id, "sub-complete");
  });

  it("invalid submission → REJECTED (no authorization ticket)", () => {
    const svc = new VerificationService({
      jobId: JOB,
      worker: WORKER,
      verifier: VERIFIER,
      requirements: BOTH,
      clock: () => NOW,
    });
    const sub: Submission = {
      ...baseSubmission(),
      submission_id: "sub-bad",
      checklist_results: [{ requirement_id: "checklist", completed: false }],
      evidence: [photo("e1")], // also short one photo
    };
    const r = svc.submit(sub);
    assert.equal(r.status, "REJECTED");
    assert.throws(() => svc.authorizeOnChainVerify(r), /cannot authorize/);
  });

  it("evidence hash generation", () => {
    // Known SHA-256 vector.
    assert.equal(
      sha256Hex("abc"),
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    const ev = photo("e1");
    assert.isTrue(verifyEvidenceContent(ev, "bytes-for-e1"));
    assert.isFalse(verifyEvidenceContent(ev, "tampered-bytes"));
    assert.isFalse(verifyEvidenceContent({ content_hash: "zz" }, "bytes-for-e1"));
  });

  it("deterministic verification", () => {
    const sub = {
      ...baseSubmission(),
      checklist_results: [{ requirement_id: "checklist", completed: true }],
    };
    const a = run(CHECK_ONLY, JSON.parse(JSON.stringify(sub)));
    const b = run(CHECK_ONLY, JSON.parse(JSON.stringify(sub)));
    assert.deepEqual(a, b);
  });

  it("same submission produces same result", () => {
    const mkSvc = () =>
      new VerificationService({
        jobId: JOB,
        worker: WORKER,
        verifier: VERIFIER,
        requirements: BOTH,
        clock: () => NOW,
      });
    const payload = {
      ...baseSubmission(),
      checklist_results: [{ requirement_id: "checklist", completed: true }],
      evidence: [photo("e1"), photo("e2")],
    };
    const r1 = mkSvc().submit(JSON.parse(JSON.stringify({ ...payload, submission_id: "s-a" })));
    const r2 = mkSvc().submit(JSON.parse(JSON.stringify({ ...payload, submission_id: "s-a" })));
    assert.deepEqual({ ...r1, submission_id: "x" }, { ...r2, submission_id: "x" });
    assert.equal(r1.verified_at, r2.verified_at);
  });
});
