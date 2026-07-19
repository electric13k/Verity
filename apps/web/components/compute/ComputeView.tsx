"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Info, Sparkle, CaretUpDown, Check, PaperPlaneRight, CheckCircle, WarningCircle, Coins, HardDrives,
} from "@phosphor-icons/react";
import { Panel } from "@/components/glass/Panel";
import { Menu, MenuItem } from "@/components/glass/Menu";
import { submitComputeJob, api } from "@/lib/api/client";
import { MODEL_CATALOG } from "@/lib/api/mock";
import type { ComputeJobResult, ComputeStats } from "@/lib/api/types";
import { ConsensusDiagram } from "./ConsensusDiagram";

// Compute — the scattered network for house model calls. Submitting a job is
// LIVE (POST /v1/compute/jobs → 202 {job_id, work_unit_id}); the coordinator
// owns redundancy-2 assignment and consensus. Network stats (credits, nodes)
// are mock until the ledger is exposed. The submit panel carries the one glow.

// The network runs house models; the picker offers the house catalog.
const HOUSE_MODELS = MODEL_CATALOG.filter((m) => m.provider === "verity");

function StatTile({ icon, value, label }: { icon: React.ReactNode; value: string; label: string }) {
  return (
    <Panel raised className="stat-tile">
      <span className="stat-tile__icon">{icon}</span>
      <span className="stat-tile__value font-display">{value}</span>
      <span className="stat-tile__label eyebrow">{label}</span>
    </Panel>
  );
}

export function ComputeView() {
  const [stats, setStats] = useState<ComputeStats | null>(null);
  const [model, setModel] = useState(HOUSE_MODELS[0]?.selector ?? "verity:qwythos");
  const [prompt, setPrompt] = useState("");
  const [focused, setFocused] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [receipt, setReceipt] = useState<ComputeJobResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.computeStats().then(setStats);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [prompt]);

  const currentModel = HOUSE_MODELS.find((m) => m.selector === model) ?? HOUSE_MODELS[0];

  const submit = useCallback(async () => {
    const p = prompt.trim();
    if (!p || submitting) return;
    setSubmitting(true);
    setError(null);
    setReceipt(null);
    try {
      const res = await submitComputeJob({ model, prompt: p });
      setReceipt(res);
      setPrompt("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }, [prompt, model, submitting]);

  return (
    <div className="flow">
      <header className="flow__header">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Compute</span>
          <h1 className="flow__title font-display">A network that verifies its own work.</h1>
        </div>
        <span className="chat__note" title="Job submission is live against the gateway. Credits and node counts are the in-memory mock until the ledger is exposed.">
          <Info size={13} />
          Live submit
        </span>
      </header>

      <div className="flow__body scroll-quiet">
        <div className="flow__inner compute">
          {/* Network stats. */}
          <div className="compute-stats">
            <StatTile icon={<Coins size={16} weight="regular" />} value={stats ? stats.credits.toLocaleString() : "—"} label="Credits" />
            <StatTile icon={<HardDrives size={16} weight="regular" />} value={stats ? String(stats.nodes_online) : "—"} label="Nodes online" />
            <StatTile icon={<CheckCircle size={16} weight="regular" />} value={stats ? `×${stats.redundancy}` : "—"} label="Redundancy" />
            <StatTile icon={<Sparkle size={16} weight="regular" />} value={stats ? stats.jobs_verified.toLocaleString() : "—"} label="Jobs verified" />
          </div>

          {/* Submit a job. */}
          <Panel active glow={focused && !submitting} className="compute-submit">
            <div className="eyebrow" style={{ marginBottom: "var(--v-space-2)" }}>Submit a job</div>
            <textarea
              ref={ref}
              className="flow-run__input scroll-quiet"
              value={prompt}
              rows={3}
              placeholder="A prompt for the network to run under redundancy-2 consensus…"
              aria-label="Compute prompt"
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
              }}
            />
            <div className="flow-run__bar">
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
                  HOUSE_MODELS.map((m) => (
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
              <button type="button" className="gbtn gbtn--primary" onClick={submit} disabled={!prompt.trim() || submitting}>
                <PaperPlaneRight size={14} weight="fill" />
                {submitting ? "Dispatching…" : "Submit to network"}
              </button>
            </div>

            {receipt && (
              <div className="compute-receipt v-rise" role="status">
                <CheckCircle size={16} weight="fill" style={{ color: "var(--v-matcha)" }} />
                <div>
                  <div className="compute-receipt__title">Accepted — dispatched under redundancy-2.</div>
                  <div className="compute-receipt__ids">
                    <span>job <code>{receipt.job_id || "—"}</code></span>
                    <span>work unit <code>{receipt.work_unit_id || "—"}</code></span>
                  </div>
                </div>
              </div>
            )}
            {error && (
              <div className="msg__error" style={{ marginTop: "var(--v-space-3)" }}>
                <WarningCircle size={15} weight="fill" />
                {error}
              </div>
            )}
          </Panel>

          {/* Explain the network. */}
          <Panel raised className="compute-explain">
            <div className="compute-explain__copy">
              <span className="eyebrow">How the network agrees</span>
              <h2 className="compute-explain__title font-display">Two nodes, one answer.</h2>
              <p className="compute-explain__body">
                Every job is split into work units, and each unit runs on <strong>two independent nodes</strong> chosen
                as a sybil-resistant pair. A result only counts when both nodes agree — redundancy-2 consensus. Nodes
                earn from the credits ledger for verified work, and disagreement sends the unit out for a tie-break
                rather than trusting either side.
              </p>
              <ul className="compute-explain__list">
                <li>Independent assignment — no node sees both halves of a pair.</li>
                <li>Agreement gates acceptance — a lone result never settles.</li>
                <li>House scalar calls route internally over the same network.</li>
              </ul>
            </div>
            <div className="compute-explain__figure">
              <ConsensusDiagram />
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
