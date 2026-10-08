import type { ChainState } from "../backend/types";
import type { JobStatusKind } from "../theme";

/** Map on-chain state to the one obvious mobile status. Pure (unit-tested). */
export function chainStatus(state: ChainState): { kind: JobStatusKind; label: string } {
  switch (state) {
    case "CREATED":
      return { kind: "OPEN", label: "OPEN" };
    case "FUNDED":
      return { kind: "LOCKED", label: "LOCKED" };
    case "IN_PROGRESS":
      return { kind: "OPEN", label: "IN PROGRESS" };
    case "SUBMITTED":
      return { kind: "VERIFYING", label: "VERIFYING" };
    case "VERIFIED":
      return { kind: "VERIFIED", label: "VERIFIED" };
    case "SETTLED":
      return { kind: "RELEASED", label: "RELEASED" };
    case "REJECTED":
      return { kind: "REJECTED", label: "REJECTED" };
  }
}
