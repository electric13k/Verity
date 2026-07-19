"use client";

import { useMemo } from "react";
import {
  Compass,
  Cube,
  MagnifyingGlass,
  Diamond,
  WarningCircle,
  CheckCircle,
} from "@phosphor-icons/react";
import { Panel } from "@/components/glass/Panel";
import { renderMarkdown } from "@/lib/markdown";
import type { FlowRunState, LaneStatus, WorkerLane } from "./FlowsView";

// The stage: a phase ledger (the score) beside the role lanes. Lanes rise in
// as each role reports. The converge panel carries the view's single glow —
// the answer is the focus of attention (design rule 4).

function Prose({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  return <div className="prose-verity" dangerouslySetInnerHTML={{ __html: html }} />;
}

function StatusDot({ status }: { status: LaneStatus }) {
  return <span className={`lane-dot lane-dot--${status}`} aria-hidden="true" />;
}

function ThinkingRow() {
  return (
    <span className="think-dots" aria-label="Working">
      <span /><span /><span />
    </span>
  );
}

// A single role lane.
function Lane({
  icon,
  role,
  caption,
  status,
  children,
  glow,
}: {
  icon: React.ReactNode;
  role: string;
  caption: string;
  status: LaneStatus;
  children: React.ReactNode;
  glow?: boolean;
}) {
  return (
    <Panel raised active={status === "active"} glow={glow} className="lane v-rise">
      <div className="lane__head">
        <span className="lane__glyph">{icon}</span>
        <span className="lane__role">{role}</span>
        <span className="lane__caption eyebrow">{caption}</span>
        <StatusDot status={status} />
      </div>
      <div className="lane__body">{children}</div>
    </Panel>
  );
}

function PlanSteps({ content }: { content: string }) {
  const steps = content
    .split("\n")
    .map((l) => l.replace(/^\s*\d+[.)]\s*/, "").trim())
    .filter(Boolean);
  if (steps.length === 0) return <ThinkingRow />;
  return (
    <ol className="plan-steps">
      {steps.map((s, i) => (
        <li key={i}>
          <span className="plan-steps__n">{i + 1}</span>
          <span>{s}</span>
        </li>
      ))}
    </ol>
  );
}

function WorkerCard({ lane }: { lane: WorkerLane }) {
  return (
    <Panel raised active={lane.status === "active"} className="worker-card v-rise">
      <div className="lane__head">
        <span className="lane__glyph"><Cube size={15} weight="regular" /></span>
        <span className="lane__role">Worker {lane.n}</span>
        <StatusDot status={lane.status} />
      </div>
      <div className="lane__body">
        {lane.status === "error" ? (
          <div className="msg__error"><WarningCircle size={15} weight="fill" />{lane.content || "This worker failed."}</div>
        ) : lane.content ? (
          <Prose content={lane.content} />
        ) : (
          <ThinkingRow />
        )}
      </div>
    </Panel>
  );
}

// Derive a ledger phase state from the lanes it summarizes.
function bandStatus(lanes: WorkerLane[]): LaneStatus {
  if (lanes.length === 0) return "pending";
  if (lanes.some((l) => l.status === "error")) return "error";
  if (lanes.every((l) => l.status === "done")) return "done";
  if (lanes.some((l) => l.status === "active" || l.status === "done")) return "active";
  return "pending";
}

export function FlowStage({ state }: { state: FlowRunState }) {
  const workBand = bandStatus(state.workerLanes);
  const kindLabel =
    state.resolvedKind === "diverge_converge"
      ? "Diverge · converge"
      : state.resolvedKind === "converge"
        ? "Converge"
        : "Auto";

  const ledger: { key: string; label: string; status: LaneStatus }[] = [
    { key: "plan", label: "Plan", status: state.plan.status },
    { key: "work", label: "Work", status: workBand },
    { key: "verify", label: "Verify", status: state.inspector.status },
    { key: "converge", label: "Converge", status: state.converge.status },
  ];

  return (
    <div className="flow-stage">
      <aside className="flow-ledger">
        <div className="flow-ledger__kind">
          <span className="eyebrow">Topology</span>
          <span className="flow-ledger__kindval">{kindLabel}</span>
        </div>
        <ol className="flow-ledger__steps">
          {ledger.map((p, i) => (
            <li key={p.key} className={`flow-ledger__step flow-ledger__step--${p.status}`}>
              <span className="flow-ledger__mark"><StatusDot status={p.status} /></span>
              <span className="flow-ledger__label">{p.label}</span>
              <span className="flow-ledger__n">{String(i + 1).padStart(2, "0")}</span>
            </li>
          ))}
        </ol>
        {state.status === "done" && !state.error && (
          <div className="flow-ledger__seal">
            <CheckCircle size={14} weight="fill" style={{ color: "var(--v-matcha)" }} />
            Converged
          </div>
        )}
      </aside>

      <div className="flow-lanes">
        <Lane icon={<Compass size={15} weight="regular" />} role="Conductor" caption="the plan" status={state.plan.status}>
          {state.plan.status === "pending" ? <ThinkingRow /> : <PlanSteps content={state.plan.content} />}
        </Lane>

        <div className="lane-band">
          <div className="lane-band__label eyebrow">
            {state.resolvedKind === "diverge_converge" ? "Workers · parallel angles" : "Workers · parallel"}
          </div>
          <div className="worker-band" data-count={state.workerLanes.length}>
            {state.workerLanes.map((lane) => (
              <WorkerCard key={lane.key} lane={lane} />
            ))}
          </div>
        </div>

        {(state.inspector.status !== "pending" || state.converge.status !== "pending") && (
          <Lane icon={<MagnifyingGlass size={15} weight="regular" />} role="Inspector" caption="the review" status={state.inspector.status}>
            {state.inspector.content ? <Prose content={state.inspector.content} /> : <ThinkingRow />}
          </Lane>
        )}

        {state.converge.status !== "pending" && (
          <Lane
            icon={<Diamond size={15} weight="fill" />}
            role="Converge"
            caption="the answer"
            status={state.converge.status}
            glow={state.converge.status === "done"}
          >
            {state.converge.content ? <Prose content={state.converge.content} /> : <ThinkingRow />}
          </Lane>
        )}

        {state.error && (
          <div className="flow-error msg__error">
            <WarningCircle size={16} weight="fill" />
            {state.error}
          </div>
        )}
      </div>
    </div>
  );
}
