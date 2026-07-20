"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { Info } from "@phosphor-icons/react";
import { flowStream } from "@/lib/api/client";
import { consumeHandoff } from "@/lib/handoff";
import type { FlowEvent, FlowKind } from "@/lib/api/types";
import { FlowComposer } from "./FlowComposer";
import { FlowStage } from "./FlowStage";

// Flows — Verity's signature power-view. A task is handed to a company of
// roles: a conductor plans, workers execute in parallel, an inspector reviews,
// and the work converges into one answer. The stage renders each role as it
// arrives; the left ledger is the score, tracking the four phases. This is the
// view that makes Verity not-a-chat-app, so it is staged, not dashboarded.

export type LaneStatus = "pending" | "active" | "done" | "error";

export interface WorkerLane {
  key: string;
  n: number;
  status: LaneStatus;
  content: string;
}

export interface FlowRunState {
  status: "idle" | "running" | "done" | "error";
  task: string;
  requestedKind: "" | FlowKind;
  resolvedKind: FlowKind | null; // inferred from the plan once it arrives
  workers: number;
  plan: { status: LaneStatus; content: string };
  workerLanes: WorkerLane[];
  inspector: { status: LaneStatus; content: string };
  converge: { status: LaneStatus; content: string };
  error: string | null;
}

type Action =
  | { type: "start"; task: string; kind: "" | FlowKind; workers: number }
  | { type: "event"; event: FlowEvent }
  | { type: "error"; message: string }
  | { type: "done" }
  | { type: "reset" };

const idle = (): FlowRunState => ({
  status: "idle",
  task: "",
  requestedKind: "",
  resolvedKind: null,
  workers: 2,
  plan: { status: "pending", content: "" },
  workerLanes: [],
  inspector: { status: "pending", content: "" },
  converge: { status: "pending", content: "" },
  error: null,
});

function workerN(role: string): number | null {
  const m = /^worker-(\d+)$/.exec(role);
  return m ? Number(m[1]) : null;
}

function inferKind(plan: string): FlowKind {
  return /\bangle\b/i.test(plan) ? "diverge_converge" : "converge";
}

function reducer(state: FlowRunState, action: Action): FlowRunState {
  switch (action.type) {
    case "start": {
      const n = Math.max(1, Math.min(4, action.workers));
      return {
        ...idle(),
        status: "running",
        task: action.task,
        requestedKind: action.kind,
        resolvedKind: action.kind || null,
        workers: n,
        plan: { status: "active", content: "" },
        workerLanes: Array.from({ length: n }, (_, i) => ({
          key: `worker-${i + 1}`,
          n: i + 1,
          status: "pending",
          content: "",
        })),
      };
    }
    case "event": {
      const { role, phase, content } = action.event;
      const next = { ...state };
      if (phase === "plan") {
        next.plan = { status: "done", content };
        next.resolvedKind = state.requestedKind || inferKind(content);
        next.workerLanes = state.workerLanes.map((w) => ({ ...w, status: "active" }));
        return next;
      }
      const wn = workerN(role);
      if (wn != null && (phase === "work" || phase === "error")) {
        const lanes = [...state.workerLanes];
        const idx = lanes.findIndex((w) => w.n === wn);
        const lane: WorkerLane = {
          key: `worker-${wn}`,
          n: wn,
          status: phase === "error" ? "error" : "done",
          content,
        };
        if (idx >= 0) lanes[idx] = lane;
        else lanes.push(lane);
        lanes.sort((a, b) => a.n - b.n);
        next.workerLanes = lanes;
        return next;
      }
      if (phase === "verify") {
        next.workerLanes = state.workerLanes.map((w) =>
          w.status === "pending" || w.status === "active" ? { ...w, status: "done" } : w,
        );
        next.inspector = { status: "done", content };
        next.converge = { status: "active", content: "" };
        return next;
      }
      if (phase === "converge") {
        next.converge = { status: "done", content };
        return next;
      }
      if (phase === "error") {
        next.status = "error";
        next.error = content || "The flow failed.";
        return next;
      }
      return next;
    }
    case "error":
      return { ...state, status: "error", error: action.message };
    case "done":
      return {
        ...state,
        status: state.status === "error" ? "error" : "done",
        plan: state.plan.status === "active" ? { ...state.plan, status: "done" } : state.plan,
        workerLanes: state.workerLanes.map((w) =>
          w.status === "pending" || w.status === "active" ? { ...w, status: "done" } : w,
        ),
      };
    case "reset":
      return idle();
  }
}

export function FlowsView() {
  const [state, dispatch] = useReducer(reducer, undefined, idle);
  const [prefill, setPrefill] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  // A branched message prefills the task with the conversation context.
  useEffect(() => {
    const h = consumeHandoff("flow");
    if (h) setPrefill(h.brief);
  }, []);

  const run = useCallback(
    async (task: string, kind: "" | FlowKind, workers: number, model: string) => {
      if (state.status === "running") return;
      dispatch({ type: "start", task, kind, workers });
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      await flowStream(
        { task, ...(kind ? { flow_kind: kind } : {}), model, workers },
        {
          onEvent: (event) => dispatch({ type: "event", event }),
          onError: (message) => dispatch({ type: "error", message }),
          onDone: () => dispatch({ type: "done" }),
        },
        ctrl.signal,
      );
      abortRef.current = null;
    },
    [state.status],
  );

  const stop = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "done" });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: "reset" });
  }, []);

  const active = state.status !== "idle";

  return (
    <div className="flow">
      <header className="flow__header">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Flows</span>
          <h1 className="flow__title font-display">A company of roles, one task.</h1>
        </div>
        <span className="chat__note" title="Flow streaming is live against the gateway — a conductor plans, workers run in parallel, an inspector reviews, and the work converges.">
          <Info size={13} />
          Live SSE
        </span>
      </header>

      <div className="flow__body scroll-quiet">
        <div className="flow__inner">
          <FlowComposer
            running={state.status === "running"}
            active={active}
            prefill={prefill}
            onRun={run}
            onStop={stop}
            onReset={reset}
          />
          {active && <FlowStage state={state} />}
        </div>
      </div>
    </div>
  );
}
