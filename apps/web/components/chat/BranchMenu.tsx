"use client";

import { useRouter } from "next/navigation";
import { GitBranch, FlowArrow, Buildings } from "@phosphor-icons/react";
import { Menu, MenuItem } from "@/components/glass/Menu";
import { useApp } from "@/lib/store";
import { setHandoff } from "@/lib/handoff";
import type { BranchKind } from "@/lib/api/types";

// Any message can branch into a Flow (a team working a task) or an Office (a
// scheduled, checkpointed run). The branch carries the conversation context as
// the brief: the client stashes it (lib/handoff) and navigates, and the target
// surface consumes it once to prefill. The run id comes from the mock adapter
// (POST /v1/branches is planned) so a chip has something to reference later.

export function BranchMenu({ messageId }: { messageId: string }) {
  const { branch, messages } = useApp();
  const router = useRouter();

  // Build a brief from the exchange this message belongs to: the question that
  // prompted it and the answer itself.
  const buildBrief = (): string => {
    const idx = messages.findIndex((m) => m.id === messageId);
    const answer = idx >= 0 ? messages[idx] : undefined;
    const question = idx >= 0 ? [...messages.slice(0, idx)].reverse().find((m) => m.role === "user") : undefined;
    const parts: string[] = [];
    if (question) parts.push(`Question:\n${question.content}`);
    if (answer && answer.content) parts.push(`Answer so far:\n${answer.content}`);
    return parts.join("\n\n").trim();
  };

  const go = async (kind: BranchKind, close: () => void) => {
    const brief = buildBrief();
    const runId = await branch(messageId, kind);
    setHandoff({ kind, brief, source: "chat", runId });
    close();
    router.push(kind === "flow" ? "/flows" : "/offices");
  };

  return (
    <Menu
      side="top"
      align="end"
      trigger={({ toggle, open, id }) => (
        <button
          type="button"
          className="msg__act"
          onClick={toggle}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={id}
          title="Branch into a Flow or Office"
        >
          <GitBranch size={15} />
        </button>
      )}
    >
      {(close) => (
        <>
          <div className="eyebrow" style={{ padding: "0.4rem 0.6rem 0.2rem" }}>Branch into</div>
          <MenuItem icon={<FlowArrow size={16} />} hint="team" onClick={() => go("flow", close)}>
            Flow
          </MenuItem>
          <MenuItem icon={<Buildings size={16} />} hint="scheduled" onClick={() => go("office", close)}>
            Office
          </MenuItem>
        </>
      )}
    </Menu>
  );
}
