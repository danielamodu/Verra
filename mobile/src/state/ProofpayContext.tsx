import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import { LocalDemoBackend } from "../backend/LocalDemoBackend";
import { SolanaBackend, type ChainJobState } from "../backend/SolanaBackend";
import type {
  ProofpayBackend,
  ProofpayJob,
  SettlementReceipt,
  SignedSubmission,
} from "../backend/types";
import type { VerificationResult } from "../../../verification/schema";

export type BackendKind = "demo" | "devnet";

interface ProofpayState {
  backend: ProofpayBackend;
  backendKind: BackendKind;
  useBackend: (kind: BackendKind, session?: { address: string; authToken: string }) => void;
  jobs: ProofpayJob[];
  refresh: () => Promise<void>;
  createJob: (
    input: Parameters<ProofpayBackend["createJob"]>[0],
    business: string
  ) => Promise<ProofpayJob>;
  acceptJob: (id: string, worker: string) => Promise<ProofpayJob>;
  submitCompletion: (
    id: string,
    draft: {
      submissionId: string;
      completedChecklists: string[];
      evidence: import("../backend/types").DraftEvidence[];
      deviceId?: string;
      workerSignature?: string;
    }
  ) => Promise<VerificationResult>;
  getSubmission: (id: string) => Promise<SignedSubmission | undefined>;
  releasePayment: (id: string) => Promise<SettlementReceipt>;
  requestSettlement: (id: string) => Promise<SettlementReceipt>;
  refreshChainState: (id: string) => Promise<ChainJobState | undefined>;
}

const ProofpayContext = createContext<ProofpayState | null>(null);

export function ProofpayProvider({ children }: { children: React.ReactNode }) {
  const [backend, setBackend] = useState<ProofpayBackend>(() => new LocalDemoBackend());
  const [backendKind, setBackendKind] = useState<BackendKind>("demo");
  const [jobs, setJobs] = useState<ProofpayJob[]>([]);

  const useBackend = useCallback(
    (kind: BackendKind, session?: { address: string; authToken: string }) => {
      if (kind === "devnet") {
        setBackend(new SolanaBackend(undefined, session ?? null));
      } else {
        setBackend(new LocalDemoBackend());
      }
      setBackendKind(kind);
      setJobs([]);
    },
    []
  );

  const refresh = useCallback(async () => {
    setJobs(await backend.listJobs());
  }, [backend]);

  React.useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const createJob = useCallback(
    async (input: Parameters<ProofpayBackend["createJob"]>[0], business: string) => {
      const job = await backend.createJob(input, business);
      await refresh();
      return job;
    },
    [backend, refresh]
  );

  const acceptJob = useCallback(
    async (id: string, worker: string) => {
      const job = await backend.acceptJob(id, worker);
      await refresh();
      return job;
    },
    [backend, refresh]
  );

  const submitCompletion = useCallback(
    async (
      id: string,
      draft: {
        submissionId: string;
        completedChecklists: string[];
        evidence: import("../backend/types").DraftEvidence[];
        deviceId?: string;
        workerSignature?: string;
      }
    ) => {
      const result = await backend.submitCompletion(id, draft);
      await refresh();
      return result;
    },
    [backend, refresh]
  );

  const getSubmission = useCallback(
    async (id: string) => {
      const sub = await backend.getSubmission(id);
      return sub as SignedSubmission | undefined;
    },
    [backend]
  );

  const releasePayment = useCallback(
    async (id: string) => {
      const receipt = await backend.releasePayment(id);
      await refresh();
      return receipt;
    },
    [backend, refresh]
  );

  const requestSettlement = useCallback(
    async (id: string) => {
      if (typeof backend.requestSettlement !== "function") {
        return backend.releasePayment(id);
      }
      const receipt = await backend.requestSettlement(id);
      await refresh();
      return receipt;
    },
    [backend, refresh]
  );

  const refreshChainState = useCallback(
    async (id: string) => {
      const b = backend as Partial<SolanaBackend>;
      if (typeof b.refreshChainState !== "function") return undefined;
      const chain = await b.refreshChainState(id);
      await refresh();
      return chain;
    },
    [backend, refresh]
  );

  const value = useMemo(
    () => ({
      backend, backendKind, useBackend, jobs, refresh, createJob, acceptJob,
      submitCompletion, getSubmission, releasePayment, requestSettlement, refreshChainState,
    }),
    [backend, backendKind, useBackend, jobs, refresh, createJob, acceptJob, submitCompletion, getSubmission, releasePayment, requestSettlement, refreshChainState]
  );
  return <ProofpayContext.Provider value={value}>{children}</ProofpayContext.Provider>;
}

export function useProofpay(): ProofpayState {
  const ctx = useContext(ProofpayContext);
  if (!ctx) throw new Error("useProofpay must be used inside ProofpayProvider");
  return ctx;
}
