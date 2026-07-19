"use client";

import { useState } from "react";
import { GitBranch, FlowArrow, Buildings, CheckCircle } from "@phosphor-icons/react";
import { Menu, MenuItem } from "@/components/glass/Menu";
import { useApp } from "@/lib/store";
import type { BranchKind } from "@/lib/api/types";

// Any message can branch into a Flow (a team working a task) or an Office (a
// scheduled, checkpointed run) — the conversation context becomes the brief.
// The route is planned (API_SURFACE), so this hits the mock adapter and
// returns a run id; it flips to live when /v1/branches lands.

export function BranchMenu({ messageId }: { messageId: string }) {
  const { branch } = useApp();
  const [done, setDone] = useState<{ kind: BranchKind; runId: string } | null>(null);

  const go = async (kind: BranchKind, close: () => void) => {
    const runId = await branch(messageId, kind);
    setDone({ kind, runId });
    close();
    setTimeout(() => setDone(null), 2600);
  };

  return (
    <>
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

      {done && (
        <span className="gchip" role="status" style={{ borderColor: "color-mix(in oklab, var(--v-matcha) 40%, transparent)" }}>
          <CheckCircle size={13} weight="fill" style={{ color: "var(--v-matcha)" }} />
          {done.kind === "flow" ? "Flow" : "Office"} queued · {done.runId.slice(-6)}
        </span>
      )}
    </>
  );
}
