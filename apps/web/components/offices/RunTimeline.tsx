"use client";

import { useMemo } from "react";
import { ArrowLeft } from "@phosphor-icons/react";
import { Panel } from "@/components/glass/Panel";
import { Badge } from "@/components/glass/Chip";
import { renderMarkdown } from "@/lib/markdown";
import type { OfficeRun } from "@/lib/api/types";
import { STATUS_META } from "./status";

// A run rendered as its STATE.md checkpoint document — exactly what the office
// wrote to STATE between waking and finishing (status, autonomy preamble, task,
// then a section per phase in order). This is the audit trail, so it reads as a
// ledger, not a chat log. The backend returns the markdown verbatim; we render
// it sanitized (lib/markdown). A still-running office shows a live pulse until
// its first checkpoint lands.

export function RunTimeline({ run, onBack }: { run: OfficeRun; onBack: () => void }) {
  const meta = STATUS_META[run.status] ?? STATUS_META.running;
  const html = useMemo(
    () => (run.state_md ? renderMarkdown(run.state_md) : ""),
    [run.state_md],
  );
  const running = run.status === "running";

  return (
    <div className="run-detail v-rise">
      <button type="button" className="gbtn gbtn--quiet gbtn--sm" onClick={onBack}>
        <ArrowLeft size={14} />
        All offices
      </button>

      <header className="run-detail__head">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Run · {run.id.slice(-6)}</span>
          <h2 className="font-display run-detail__title">{run.office_name || "Office run"}</h2>
          <span className="run-detail__started">
            Started {run.started_at ? new Date(run.started_at).toLocaleString() : "just now"}
            {run.finished_at ? ` · finished ${new Date(run.finished_at).toLocaleTimeString()}` : ""}
          </span>
        </div>
        <Badge dot={meta.color}>{meta.label}</Badge>
      </header>

      <Panel raised className="run-detail__panel">
        <div className="eyebrow" style={{ marginBottom: "var(--v-space-3)" }}>STATE checkpoints</div>
        {html ? (
          <div className="prose-verity ckpt__prose" dangerouslySetInnerHTML={{ __html: html }} />
        ) : running ? (
          <div style={{ display: "flex", alignItems: "center", gap: "var(--v-space-3)" }}>
            <span className="think-dots" aria-label="Running"><span /><span /><span /></span>
            <p className="run-detail__started" style={{ margin: 0 }}>
              The office is working its brief. Checkpoints appear here as each phase completes.
            </p>
          </div>
        ) : (
          <p className="run-detail__started" style={{ margin: 0 }}>This run wrote no STATE.</p>
        )}
      </Panel>
    </div>
  );
}
