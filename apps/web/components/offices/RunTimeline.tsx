"use client";

import { useMemo } from "react";
import { ArrowLeft, Compass, Cube, MagnifyingGlass, Diamond, CheckCircle } from "@phosphor-icons/react";
import { Panel } from "@/components/glass/Panel";
import { Badge } from "@/components/glass/Chip";
import { renderMarkdown } from "@/lib/markdown";
import type { OfficeRun, OfficeRunPhase } from "@/lib/api/types";
import { STATUS_META } from "./status";

// A run rendered as its STATE.md checkpoint timeline: every phase the office
// wrote to STATE between waking and finishing, in order. This is the audit
// trail — what was decided, by which role, and when — so it reads as a ledger,
// not a chat log.

const ROLE_GLYPH: Record<string, React.ReactNode> = {
  conductor: <Compass size={14} weight="regular" />,
  inspector: <MagnifyingGlass size={14} weight="regular" />,
  flow: <Diamond size={14} weight="fill" />,
};
function glyphFor(role: string) {
  if (role.startsWith("worker")) return <Cube size={14} weight="regular" />;
  return ROLE_GLYPH[role] ?? <Cube size={14} weight="regular" />;
}
function roleLabel(role: string): string {
  if (role === "flow") return "Converge";
  if (role.startsWith("worker-")) return `Worker ${role.slice(7)}`;
  return role.charAt(0).toUpperCase() + role.slice(1);
}
function clockTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function Checkpoint({ phase, last }: { phase: OfficeRunPhase; last: boolean }) {
  const html = useMemo(
    () => (phase.content ? renderMarkdown(phase.content) : ""),
    [phase.content],
  );
  const isSeal = phase.phase === "done";
  return (
    <li className={`ckpt${last ? " ckpt--last" : ""}`}>
      <span className="ckpt__rail" aria-hidden="true">
        <span className="ckpt__node">{isSeal ? <CheckCircle size={13} weight="fill" /> : glyphFor(phase.role)}</span>
      </span>
      <div className="ckpt__body">
        <div className="ckpt__head">
          <span className="ckpt__role">{isSeal ? "Sealed" : roleLabel(phase.role)}</span>
          <span className="eyebrow ckpt__phase">{phase.phase}</span>
          <span className="ckpt__time">{clockTime(phase.at)}</span>
        </div>
        {isSeal ? (
          <p className="ckpt__seal">Run complete — STATE checkpointed.</p>
        ) : (
          <div className="prose-verity ckpt__prose" dangerouslySetInnerHTML={{ __html: html }} />
        )}
      </div>
    </li>
  );
}

export function RunTimeline({ run, onBack }: { run: OfficeRun; onBack: () => void }) {
  const meta = STATUS_META[run.status];
  return (
    <div className="run-detail v-rise">
      <button type="button" className="gbtn gbtn--quiet gbtn--sm" onClick={onBack}>
        <ArrowLeft size={14} />
        All offices
      </button>

      <header className="run-detail__head">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Run · {run.id.slice(-6)}</span>
          <h2 className="font-display run-detail__title">{run.office_name}</h2>
          <span className="run-detail__started">Started {new Date(run.started_at).toLocaleString()}</span>
        </div>
        <Badge dot={meta.color}>{meta.label}</Badge>
      </header>

      <Panel raised className="run-detail__panel">
        <div className="eyebrow" style={{ marginBottom: "var(--v-space-3)" }}>STATE checkpoints</div>
        <ol className="ckpt-list">
          {run.phases.map((p, i) => (
            <Checkpoint key={`${p.role}-${i}`} phase={p} last={i === run.phases.length - 1} />
          ))}
        </ol>
      </Panel>
    </div>
  );
}
