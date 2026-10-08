/**
 * SolanaBackend: reads are real (IDL decode), writes throw NotWiredError.
 * Runs under ts-mocha (plain Node), not jest — web3.js/anchor load cleanly
 * in Node while jest's CJS sandbox cannot parse their ESM-only transitive
 * deps. The app bundle (Metro) is unaffected.
 */
import { PublicKey } from "@solana/web3.js";
import { BN, BorshAccountsCoder } from "@coral-xyz/anchor";
import { assert } from "chai";
import idl from "../../idl/proofpay.json";
import {
  SolanaBackend,
  decodeJobState,
  explorerUrl,
  PROGRAM_ID,
} from "../src/backend/SolanaBackend";
import { NotWiredError } from "../src/backend/types";

describe("SolanaBackend", () => {
  it("targets the deployed devnet program", () => {
    assert.equal(PROGRAM_ID.toBase58(), "EmAPVEMNMa5vmS2GaFSjfNjg1JeWyUhy4fCe3c6PyoMp");
    assert.isTrue(new SolanaBackend().settlesOnChain);
  });

  it("user-signed methods require a wallet session first", async () => {
    const b = new SolanaBackend();
    await b.createJob({} as any, "x").then(
      () => assert.fail("must throw"),
      (e) => assert.match(e.message, /Connect a wallet first/)
    );
    await b.acceptJob("x", "y").then(
      () => assert.fail("must throw"),
      (e) => assert.match(e.message, /Connect a wallet first/)
    );
  });

  it("verifier-key steps never run on-device (NotWiredError, never faked)", async () => {
    const b = new SolanaBackend();
    await b.releasePayment("x").then(
      () => assert.fail("must throw"),
      (e) => assert.instanceOf(e, NotWiredError)
    );
    await b.requestSettlement("x").then(
      () => assert.fail("must throw"),
      (e) => assert.instanceOf(e, NotWiredError)
    );
  });

  it("decodes a real IDL-encoded Job account", async () => {
    const coder = new BorshAccountsCoder(idl as any);
    // Deterministic PDAs — public addresses only, no keypairs anywhere.
    const [business] = PublicKey.findProgramAddressSync([Buffer.from("test-business")], PROGRAM_ID);
    const [worker] = PublicKey.findProgramAddressSync([Buffer.from("test-worker")], PROGRAM_ID);
    const [verifier] = PublicKey.findProgramAddressSync([Buffer.from("test-verifier")], PROGRAM_ID);
    const buf: Buffer = await coder.encode("Job", {
      job_id: new BN(7),
      business,
      worker,
      verifier,
      payment_amount: new BN(150_000_000),
      usdc_mint: new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"),
      state: { Verified: {} },
      created_at: new BN(1_700_000_000),
      bump: 255,
    });
    const decoded = decodeJobState(buf);
    assert.deepEqual(
      { ...decoded, worker: decoded.worker },
      {
        found: true,
        state: "VERIFIED",
        paymentBaseUnits: 150_000_000,
        worker: worker.toBase58(),
      }
    );
  });

  it("builds explorer links", () => {
    assert.include(explorerUrl("sig123"), "cluster=devnet");
  });
});
