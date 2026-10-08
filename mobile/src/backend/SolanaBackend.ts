/**
 * Real Solana backend (devnet).
 *
 * Reads are live RPC (fetchChainState: getAccountInfo + IDL decode).
 * User-signed calls (create / fund / accept / submit) build genuine Anchor
 * transactions and send them through Mobile Wallet Adapter sign-and-send —
 * the phone user approves each transaction in their wallet app (Seed Vault).
 *
 * verify_job and release_payment require the VERIFIER key, which NEVER
 * lives on the phone. Those steps run through the backend API
 * (EXPO_PUBLIC_VERRA_API_URL), operated alongside the Phase 2
 * VerificationService: requestSettlement posts the job, the backend
 * verifies + signs, and the app only constructs a receipt from CONFIRMED
 * on-chain signatures. Nothing here can fake a settlement.
 */
import {
  AnchorProvider,
  BN,
  BorshAccountsCoder,
  Program,
} from "@coral-xyz/anchor";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
} from "@solana/spl-token";
import { transact } from "@solana-mobile/mobile-wallet-adapter-protocol-web3js";
import idl from "../../../idl/proofpay.json";
import { deriveJobPda } from "../../../verification/onchain";
import type { Submission, VerificationResult } from "../../../verification/schema";
import {
  NotWiredError,
  submissionFromDraft,
  type ChainState,
  type CreateJobInput,
  type DraftEvidence,
  type ProofpayBackend,
  type ProofpayJob,
  type SettlementReceipt,
} from "./types";

export const DEVNET_RPC = "https://api.devnet.solana.com";
export const PROGRAM_ID = new PublicKey("EmAPVEMNMa5vmS2GaFSjfNjg1JeWyUhy4fCe3c6PyoMp");
/** Official Circle USDC mint on devnet (6 decimals). */
export const DEVNET_USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
export const VERRA_API_URL: string =
  (typeof process !== "undefined" && (process as any).env?.EXPO_PUBLIC_VERRA_API_URL) || "";

const coder = new BorshAccountsCoder(idl as any);

export interface ChainJobState {
  found: boolean;
  state?: ChainState;
  paymentBaseUnits?: number;
  worker?: string;
}

const STATE_NAMES: ChainState[] = [
  "CREATED",
  "FUNDED",
  "IN_PROGRESS",
  "SUBMITTED",
  "VERIFIED",
  "REJECTED",
  "SETTLED",
];

export function decodeJobState(data: Buffer): ChainJobState {
  try {
    const decoded: any = coder.decode("Job", data);
    const keys = decoded?.state ? Object.keys(decoded.state) : [];
    // Normalize casing: direct coder.decode yields IDL names ("Verified")
    // while program.account.fetch historically yields camelCase ("verified").
    const raw = keys.length === 1 ? keys[0] : null;
    const name = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : null;
    const map: Record<string, ChainState> = {
      Created: "CREATED",
      Funded: "FUNDED",
      InProgress: "IN_PROGRESS",
      Submitted: "SUBMITTED",
      Verified: "VERIFIED",
      Rejected: "REJECTED",
      Settled: "SETTLED",
    };
    const state = name && map[name] ? map[name] : undefined;
    if (!state || !STATE_NAMES.includes(state)) return { found: true };
    return {
      found: true,
      state,
      // Note: direct coder.decode yields IDL (snake_case) field names.
      paymentBaseUnits: (decoded as any).payment_amount?.toNumber?.(),
      worker: decoded.worker?.toBase58?.(),
    };
  } catch {
    return { found: true };
  }
}

export function explorerUrl(signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=devnet`;
}

function apiError(what: string): never {
  throw new NotWiredError(
    `${what} needs the Verra backend API (set EXPO_PUBLIC_VERRA_API_URL; ` +
      `see docs/mobile.md “Wiring the real backend”)`
  );
}

/**
 * Send an unsigned transaction via the wallet app (user taps approve).
 * Returns the confirmed signature.
 */
export async function sendViaMwa(
  connection: Connection,
  transaction: Transaction,
  signerAddress: string,
  authToken: string
): Promise<string> {
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash("confirmed");
  transaction.recentBlockhash = blockhash;
  transaction.feePayer = new PublicKey(signerAddress);
  const signature: string = await transact(async (wallet: any) => {
    if (typeof wallet.signAndSendTransactions !== "function") {
      throw new Error("Wallet does not support sign-and-send.");
    }
    const res = await wallet.signAndSendTransactions({
      transactions: [transaction],
      ...(authToken ? { authToken } : {}),
    });
    const sig = res?.signatures?.[0] ?? res?.[0];
    if (typeof sig !== "string" || !sig) {
      throw new Error("Wallet did not return a transaction signature.");
    }
    return sig;
  });
  await connection.confirmTransaction(
    { signature, blockhash, lastValidBlockHeight },
    "confirmed"
  );
  return signature;
}

export interface MwaSession {
  address: string;
  authToken: string;
}

export class SolanaBackend implements ProofpayBackend {
  readonly backendName = "Solana devnet";
  readonly settlesOnChain = true;
  private connection: Connection;
  private session: MwaSession | null = null;
  private counter = 0;
  /** Jobs created in this session (no indexer yet — see docs/mobile.md). */
  private sessionJobs = new Map<string, ProofpayJob>();

  constructor(rpcUrl: string = DEVNET_RPC, session: MwaSession | null = null) {
    this.connection = new Connection(rpcUrl, "confirmed");
    this.session = session;
  }

  setSession(session: MwaSession | null) {
    this.session = session;
  }

  private requireSession(): MwaSession {
    if (!this.session) {
      throw new Error("Connect a wallet first — every transaction is user-signed.");
    }
    return this.session;
  }

  private programFor(address: string): any {
    const provider = new AnchorProvider(
      this.connection,
      { publicKey: new PublicKey(address) } as any,
      { commitment: "confirmed" }
    );
    return new Program(idl as any, provider);
  }

  private track(job: ProofpayJob): ProofpayJob {
    this.sessionJobs.set(job.id, job);
    return job;
  }

  /** Live read: fetch + decode the on-chain Job account. */
  async fetchChainState(jobPda: PublicKey): Promise<ChainJobState> {
    const info = await this.connection.getAccountInfo(jobPda);
    if (!info) return { found: false };
    return decodeJobState(info.data as Buffer);
  }

  async listJobs(): Promise<ProofpayJob[]> {
    return [...this.sessionJobs.values()];
  }

  async getJob(id: string): Promise<ProofpayJob> {
    const job = this.sessionJobs.get(id);
    if (!job) throw new NotWiredError("SolanaBackend.getJob (no indexer yet)");
    return job;
  }

  async getSubmission(id: string): Promise<Submission | undefined> {
    if (!VERRA_API_URL) return undefined;
    try {
      const res = await fetch(`${VERRA_API_URL}/api/submissions/${id}`);
      if (!res.ok) return undefined;
      return (await res.json()) as Submission;
    } catch {
      return undefined;
    }
  }

  /**
   * Business signs create_job AND the USDC fund transfer (two wallet
   * approvals — “Fund & Publish”). Requires devnet USDC in the business
   * wallet (Circle faucet); otherwise the fund transaction fails loudly
   * instead of pretending.
   */
  async createJob(input: CreateJobInput, business: string): Promise<ProofpayJob> {
    const { address, authToken } = this.requireSession();
    if (address !== business) throw new Error("Connected wallet is not the business.");
    if (!input.verifier) {
      throw new Error("A verifier address is required (the Verra verifier — see docs/mobile.md).");
    }
    this.counter += 1;
    const jobId = new BN(`${Date.now()}${this.counter}`.slice(-12));
    const program = this.programFor(address);
    const businessPk = new PublicKey(business);
    const [jobPda] = deriveJobPda(PROGRAM_ID, businessPk, jobId);
    const workerPk = new PublicKey(input.worker);

    const createTx: Transaction = await program.methods
      .createJob(jobId, workerPk, new PublicKey(input.verifier), new BN(input.paymentBaseUnits))
      .accounts({
        business: businessPk,
        job: jobPda,
        usdcMint: DEVNET_USDC_MINT,
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      })
      .transaction();
    const sigCreate = await sendViaMwa(this.connection, createTx, address, authToken);

    const businessAta = await getAssociatedTokenAddress(DEVNET_USDC_MINT, businessPk);
    const escrowAta = await getAssociatedTokenAddress(DEVNET_USDC_MINT, jobPda, true);
    const fundTx: Transaction = await program.methods
      .fundJob()
      .accounts({
        business: businessPk,
        job: jobPda,
        usdcMint: DEVNET_USDC_MINT,
        businessAta,
        escrowAta,
        tokenProgram: TOKEN_PROGRAM_ID,
        associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
        systemProgram: new PublicKey("11111111111111111111111111111111"),
      })
      .transaction();
    const sigFund = await sendViaMwa(this.connection, fundTx, address, authToken);

    const at = new Date().toISOString();
    return this.track({
      id: jobId.toString(),
      title: input.title,
      description: input.description,
      paymentBaseUnits: input.paymentBaseUnits,
      business,
      worker: input.worker,
      chainState: "FUNDED",
      requirements: input.requirements,
      activity: [
        { key: "created", label: `Job created (${sigCreate.slice(0, 8)}…)`, at },
        { key: "funded", label: `Funds locked (${sigFund.slice(0, 8)}…)`, at },
      ],
    });
  }

  /** Worker signs accept_job. */
  async acceptJob(id: string, worker: string): Promise<ProofpayJob> {
    const { address, authToken } = this.requireSession();
    if (address !== worker) throw new Error("Connected wallet is not the assigned worker.");
    const job = await this.getJob(id);
    const program = this.programFor(address);
    const [jobPda] = deriveJobPda(PROGRAM_ID, new PublicKey(job.business), new BN(job.id));
    const tx: Transaction = await program.methods
      .acceptJob()
      .accounts({ worker: new PublicKey(worker), job: jobPda })
      .transaction();
    const sig = await sendViaMwa(this.connection, tx, address, authToken);
    job.chainState = "IN_PROGRESS";
    job.activity.push({ key: "accepted", label: `Worker accepted (${sig.slice(0, 8)}…)`, at: new Date().toISOString() });
    return job;
  }

  /**
   * Worker submits: evidence goes to the backend API (stored + verified),
   * then the worker signs the on-chain submit_job transaction.
   */
  async submitCompletion(
    id: string,
    draft: { submissionId: string; completedChecklists: string[]; evidence: DraftEvidence[]; deviceId?: string; workerSignature?: string }
  ): Promise<VerificationResult> {
    if (!VERRA_API_URL) apiError("SolanaBackend.submitCompletion");
    const { address, authToken } = this.requireSession();
    const job = await this.getJob(id);
    if (address !== job.worker) throw new Error("Connected wallet is not the assigned worker.");
    const submission = submissionFromDraft(
      job,
      job.worker,
      draft.submissionId,
      draft.completedChecklists,
      draft.evidence,
      new Date().toISOString(),
      draft.deviceId
    );
    if (draft.workerSignature) (submission as any).worker_signature = draft.workerSignature;
    const res = await fetch(`${VERRA_API_URL}/api/submissions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(submission),
    });
    if (!res.ok) throw new Error(`Submission upload failed (${res.status}).`);
    const result = (await res.json()) as VerificationResult;
    const program = this.programFor(address);
    const [jobPda] = deriveJobPda(PROGRAM_ID, new PublicKey(job.business), new BN(job.id));
    const tx: Transaction = await program.methods
      .submitJob()
      .accounts({ worker: new PublicKey(job.worker), job: jobPda })
      .transaction();
    const sig = await sendViaMwa(this.connection, tx, address, authToken);
    job.submissionId = submission.submission_id;
    job.verification = result;
    job.chainState = "SUBMITTED";
    job.activity.push({ key: "submitted", label: `Evidence submitted (${sig.slice(0, 8)}…)`, at: new Date().toISOString() });
    return result;
  }

  async getVerification(id: string): Promise<VerificationResult | undefined> {
    return (await this.getJob(id)).verification;
  }

  /** Re-read on-chain truth into the session job (chain → UI). */
  async refreshChainState(id: string): Promise<ChainJobState> {
    const job = await this.getJob(id);
    const [jobPda] = deriveJobPda(PROGRAM_ID, new PublicKey(job.business), new BN(job.id));
    const chain = await this.fetchChainState(jobPda);
    if (chain.state) job.chainState = chain.state;
    return chain;
  }

  async releasePayment(_id: string): Promise<SettlementReceipt> {
    throw new NotWiredError("SolanaBackend.releasePayment (use requestSettlement)");
  }

  /**
   * Ask the backend service (verifier-key holder) to verify + settle.
   * Only a CONFIRMED on-chain SETTLED state produces a real receipt.
   */
  async requestSettlement(id: string): Promise<SettlementReceipt> {
    if (!VERRA_API_URL) apiError("SolanaBackend.requestSettlement");
    const job = await this.getJob(id);
    const res = await fetch(`${VERRA_API_URL}/api/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jobId: id }),
    });
    if (!res.ok) throw new Error(`Settlement request failed (${res.status}).`);
    const body = (await res.json()) as { verifySignature: string; releaseSignature: string };
    if (!body.verifySignature || !body.releaseSignature) {
      throw new Error("Backend did not return settlement signatures.");
    }
    for (const sig of [body.verifySignature, body.releaseSignature]) {
      const st = await this.connection.getSignatureStatuses([sig]);
      if (st.value[0]?.err) throw new Error(`On-chain transaction failed: ${sig}`);
    }
    const chain = await this.refreshChainState(id);
    if (chain.state !== "SETTLED") {
      throw new Error("Settlement not confirmed on-chain — no receipt issued.");
    }
    const receipt: SettlementReceipt = {
      real: true,
      signature: body.releaseSignature,
      verifySignature: body.verifySignature,
      amountBaseUnits: job.paymentBaseUnits,
      worker: job.worker,
      note: `Settled on devnet. Verify: ${body.verifySignature}`,
    };
    job.settlement = receipt;
    job.activity.push({ key: "released", label: "Payment released", at: new Date().toISOString() });
    return receipt;
  }
}
