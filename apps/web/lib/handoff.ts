// Branch handoff — carries conversation context from a chat message to the
// Flows or Offices view when a message is branched. Client-only SPA state: the
// menu stashes a brief, navigates, and the target view consumes it once.
//
// This is the client half of POST /v1/branches ({message_id, kind, brief}).
// The mock returns a run id for the chip; the real prefill is the brief we
// carry here so the target surface opens ready to run.

import type { BranchKind } from "./api/types";

export interface BranchHandoff {
  kind: BranchKind;
  brief: string;
  source: string; // short label of where it came from
  runId: string;
}

let pending: BranchHandoff | null = null;

export function setHandoff(h: BranchHandoff): void {
  pending = h;
}

// Consume clears it — a handoff prefills exactly once, never on a later visit.
export function consumeHandoff(kind: BranchKind): BranchHandoff | null {
  if (pending && pending.kind === kind) {
    const h = pending;
    pending = null;
    return h;
  }
  return null;
}
