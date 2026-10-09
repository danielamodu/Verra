/**
 * Ordering regression test: the worker's submit transaction must be signed
 * BEFORE anything is POSTed, so a wallet rejection leaves no orphan
 * SUBMITTED state in the backend. Runs under ts-mocha (plain Node).
 */
import { assert } from "chai";
import "./setup-env";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { SolanaBackend } = require("../src/backend/SolanaBackend");

const BIZ = "11111111111111111111111111111111";
const WORKER = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

describe("submit ordering", () => {
  it("signs the submit tx before POSTing submission and verification", async () => {
    const backend = new SolanaBackend("http://127.0.0.1:8899", {
      address: WORKER,
      authToken: "",
    });
    (backend as any).sessionJobs.set("9001", {
      id: "9001",
      title: "t",
      description: "",
      paymentBaseUnits: 1,
      business: BIZ,
      worker: WORKER,
      chainState: "IN_PROGRESS",
      requirements: [],
      activity: [],
    });

    const order: string[] = [];
    (backend as any).sender = async () => {
      order.push("tx");
      return "sig-tx";
    };
    const realFetch = (global as any).fetch;
    (global as any).fetch = async (url: string) => {
      order.push(`POST ${new URL(url).pathname}`);
      if (String(url).includes("/api/submissions")) {
        return { ok: true, json: async () => ({}) };
      }
      return {
        ok: true,
        json: async () => ({
          result: {
            status: "VERIFIED",
            job_id: "9001",
            submission_id: "s-1",
            worker: WORKER,
            checks: [],
            verified_at: new Date().toISOString(),
            reason: "ok",
          },
        }),
      };
    };
    try {
      const result = await backend.submitCompletion("9001", {
        submissionId: "s-1",
        completedChecklists: [],
        evidence: [],
        deviceId: "dev-1",
      });
      assert.equal(result.status, "VERIFIED");
    } finally {
      (global as any).fetch = realFetch;
    }
    assert.deepEqual(order, ["tx", "POST /api/submissions", "POST /api/verification/s-1"]);
  });
});
