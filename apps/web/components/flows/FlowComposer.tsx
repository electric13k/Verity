"use client";

import { useEffect, useRef, useState } from "react";
import {
  CaretUpDown,
  Check,
  Sparkle,
  Play,
  Stop,
  ArrowCounterClockwise,
  Minus,
  Plus,
} from "@phosphor-icons/react";
import { Panel } from "@/components/glass/Panel";
import { Menu, MenuItem } from "@/components/glass/Menu";
import { MODEL_CATALOG } from "@/lib/api/mock";
import type { FlowKind } from "@/lib/api/types";
import { FlowTopology } from "./FlowTopology";

// The run bar. Task, topology choice (auto / converge / diverge-converge),
// worker count, model, and run. It carries the view's single glow while the
// task field is focused — hierarchy is attention (design rule 4).

const KINDS: { value: "" | FlowKind; label: string; hint: string }[] = [
  { value: "", label: "Auto", hint: "engine picks" },
  { value: "converge", label: "Converge", hint: "split into subtasks" },
  { value: "diverge_converge", label: "Diverge · converge", hint: "same task, many angles" },
];

interface Props {
  running: boolean;
  active: boolean;
  prefill: string;
  onRun: (task: string, kind: "" | FlowKind, workers: number, model: string) => void;
  onStop: () => void;
  onReset: () => void;
}

export function FlowComposer({ running, active, prefill, onRun, onStop, onReset }: Props) {
  const [task, setTask] = useState("");
  const [kind, setKind] = useState<"" | FlowKind>("");
  const [workers, setWorkers] = useState(2);
  const [model, setModel] = useState("echo:echo");
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (prefill) {
      setTask(prefill);
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [prefill]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [task]);

  const currentModel = MODEL_CATALOG.find((m) => m.selector === model) ?? MODEL_CATALOG[0];
  const canRun = task.trim().length > 0 && !running;

  const submit = () => {
    if (!canRun) return;
    onRun(task.trim(), kind, workers, model);
  };

  return (
    <Panel active glow={focused && !running} className="flow-run">
      <div className="flow-run__grid">
        <textarea
          ref={ref}
          className="flow-run__input scroll-quiet"
          value={task}
          rows={2}
          placeholder="Describe the task for the company to work — e.g. “Draft a go-to-market plan for a solo hardware launch, then pressure-test it.”"
          aria-label="Flow task"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              submit();
            }
          }}
        />
        <FlowTopology kind={kind || "converge"} workers={workers} muted={!focused && !active} />
      </div>

      <div className="flow-run__bar">
        <div className="flow-run__controls">
          {/* Topology choice — the converge vs diverge-converge indicator. */}
          <Menu
            side="top"
            align="start"
            trigger={({ toggle, open, id }) => (
              <button type="button" className="gchip" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={id}>
                <span className="gchip__dot" style={{ background: "var(--v-brass)" }} />
                {KINDS.find((k) => k.value === kind)?.label}
                <CaretUpDown size={12} style={{ opacity: 0.6 }} />
              </button>
            )}
          >
            {(close) =>
              KINDS.map((k) => (
                <MenuItem
                  key={k.value || "auto"}
                  active={k.value === kind}
                  hint={k.hint}
                  icon={k.value === kind ? <Check size={15} weight="bold" /> : <span style={{ width: 15 }} />}
                  onClick={() => { setKind(k.value); close(); }}
                >
                  {k.label}
                </MenuItem>
              ))
            }
          </Menu>

          {/* Worker count. */}
          <div className="flow-stepper" role="group" aria-label="Workers">
            <button type="button" className="flow-stepper__btn" aria-label="Fewer workers" disabled={workers <= 1} onClick={() => setWorkers((w) => Math.max(1, w - 1))}>
              <Minus size={12} weight="bold" />
            </button>
            <span className="flow-stepper__val">{workers} <span className="flow-stepper__unit">{workers === 1 ? "worker" : "workers"}</span></span>
            <button type="button" className="flow-stepper__btn" aria-label="More workers" disabled={workers >= 4} onClick={() => setWorkers((w) => Math.min(4, w + 1))}>
              <Plus size={12} weight="bold" />
            </button>
          </div>

          {/* Model. */}
          <Menu
            side="top"
            align="start"
            trigger={({ toggle, open, id }) => (
              <button type="button" className="gchip" onClick={toggle} aria-haspopup="menu" aria-expanded={open} aria-controls={id}>
                <Sparkle size={13} weight="fill" style={{ color: "var(--v-chai)" }} />
                {currentModel?.label ?? "Model"}
                <CaretUpDown size={12} style={{ opacity: 0.6 }} />
              </button>
            )}
          >
            {(close) =>
              MODEL_CATALOG.map((m) => (
                <MenuItem
                  key={m.selector}
                  active={m.selector === model}
                  icon={m.selector === model ? <Check size={15} weight="bold" /> : <span style={{ width: 15 }} />}
                  onClick={() => { setModel(m.selector); close(); }}
                >
                  {m.label}
                </MenuItem>
              ))
            }
          </Menu>
        </div>

        <div className="flex items-center gap-2">
          {active && !running && (
            <button type="button" className="gbtn gbtn--quiet gbtn--sm" onClick={onReset}>
              <ArrowCounterClockwise size={14} />
              New run
            </button>
          )}
          {running ? (
            <button type="button" className="gbtn gbtn--quiet gbtn--sm" onClick={onStop}>
              <Stop size={14} weight="fill" />
              Stop
            </button>
          ) : (
            <button type="button" className="gbtn gbtn--primary" onClick={submit} disabled={!canRun}>
              <Play size={14} weight="fill" />
              Run flow
            </button>
          )}
        </div>
      </div>
    </Panel>
  );
}
