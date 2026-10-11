export type RootStackParamList = {
  Connect: undefined;
  Role: undefined;
  BusinessHome: undefined;
  CreateJob: undefined;
  WorkerHome: undefined;
  JobDetail: { jobId: string };
  ExecuteJob: { jobId: string };
  Evidence: { jobId: string; completedChecklists: string[] };
  Review: {
    jobId: string;
    completedChecklists: string[];
    photos: import("../backend/types").DraftEvidence[];
  };
  Verification: { jobId: string };
  Settlement: { jobId: string };
  Receipt: { jobId: string };
  Activity: { jobId: string };
  Stake: undefined;
};
