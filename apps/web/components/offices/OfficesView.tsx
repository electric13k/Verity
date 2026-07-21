"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { Info, Plus, Play, Clock, TrashSimple, ArrowRight, Buildings } from "@phosphor-icons/react";
import { Panel } from "@/components/glass/Panel";
import { Badge } from "@/components/glass/Chip";
import { Modal } from "@/components/glass/Modal";
import { Button } from "@/components/glass/Button";
import { Skeleton } from "@/components/glass/Skeleton";
import { api } from "@/lib/api/client";
import { IS_MOCK } from "@/lib/api/config";
import { consumeHandoff } from "@/lib/handoff";
import type { Office, OfficeInput, OfficeRun } from "@/lib/api/types";
import { STATUS_META, humanizeCron } from "./status";
import { OfficeForm } from "./OfficeForm";

// The run timeline pulls in the markdown renderer to draw a STATE checkpoint
// document — only needed once a run is opened, so it loads on demand.
const RunTimeline = dynamic(
  () => import("./RunTimeline").then((m) => m.RunTimeline),
  {
    ssr: false,
    loading: () => (
      <Panel raised className="run-detail__panel">
        <Skeleton lines={5} aria-label="Loading run" />
      </Panel>
    ),
  },
);

// Offices — a Flow with a clock and a memory. This view lists them, creates
// them, runs one on demand, and opens a run as its STATE checkpoint timeline.
// CRUD runs through the typed client (mock adapter today; flips live when the
// office routes land). One glow at a time: the create modal owns it when open.

function OfficeCard({
  office,
  busy,
  onRun,
  onOpen,
  onDelete,
}: {
  office: Office;
  busy: boolean;
  onRun: () => void;
  onOpen: () => void;
  onDelete: () => void;
}) {
  const meta = STATUS_META[office.status];
  return (
    <Panel raised className="office-card v-rise">
      <div className="office-card__top">
        <div style={{ minWidth: 0 }}>
          <h3 className="office-card__name font-display">{office.name}</h3>
          <span className="office-card__sched">
            <Clock size={12} weight="regular" />
            {humanizeCron(office.schedule)}
          </span>
        </div>
        <Badge dot={meta.color}>{meta.label}</Badge>
      </div>

      <p className="office-card__brief">{office.brief}</p>

      <div className="office-card__foot">
        <div className="office-card__actions">
          <Button size="sm" variant="primary" onClick={onRun} disabled={busy}>
            <Play size={13} weight="fill" />
            {busy ? "Running…" : "Run now"}
          </Button>
          {office.last_run_id && (
            <Button size="sm" variant="quiet" onClick={onOpen}>
              Last run
              <ArrowRight size={13} />
            </Button>
          )}
        </div>
        <button type="button" className="office-card__del" aria-label={`Delete ${office.name}`} onClick={onDelete}>
          <TrashSimple size={15} />
        </button>
      </div>
    </Panel>
  );
}

export function OfficesView() {
  const [offices, setOffices] = useState<Office[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [initialBrief, setInitialBrief] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openRun, setOpenRun] = useState<OfficeRun | null>(null);

  const refresh = useCallback(() => {
    api.listOffices().then(setOffices);
  }, []);

  useEffect(() => {
    refresh();
    // A branched message opens the create form with the conversation as brief.
    const h = consumeHandoff("office");
    if (h) {
      setInitialBrief(h.brief);
      setCreating(true);
    }
  }, [refresh]);

  const create = useCallback(
    async (input: OfficeInput) => {
      await api.createOffice(input);
      setCreating(false);
      setInitialBrief("");
      refresh();
    },
    [refresh],
  );

  // Running an office kicks off a background run (202 → run_id). Open its run
  // detail immediately; a polling effect below follows it to completion.
  const run = useCallback(async (office: Office) => {
    setBusyId(office.id);
    const { run_id } = await api.runOffice(office.id);
    setBusyId(null);
    if (run_id) {
      const detail = await api.getOfficeRun(office.id, run_id);
      if (detail) setOpenRun({ ...detail, office_name: office.name });
      // Remember the run in-session so "Last run" reopens it (the office list
      // route carries no last-run pointer).
      setOffices((prev) =>
        prev ? prev.map((o) => (o.id === office.id ? { ...o, last_run_id: run_id } : o)) : prev,
      );
    }
  }, []);

  const openLast = useCallback(async (office: Office) => {
    if (!office.last_run_id) return;
    const detail = await api.getOfficeRun(office.id, office.last_run_id);
    if (detail) setOpenRun({ ...detail, office_name: office.name });
  }, []);

  // Follow a still-running office to completion, preserving the office name.
  useEffect(() => {
    if (!openRun || openRun.status !== "running") return;
    let live = true;
    const t = setTimeout(async () => {
      const detail = await api.getOfficeRun(openRun.office_id, openRun.id);
      if (live && detail) setOpenRun({ ...detail, office_name: openRun.office_name });
    }, 1000);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [openRun]);

  const remove = useCallback(async (id: string) => {
    // No DELETE route (platform.go) — drop it locally so the action reads true
    // in-session; a reload re-lists it in live mode.
    setOffices((prev) => (prev ? prev.filter((o) => o.id !== id) : prev));
    await api.deleteOffice(id);
  }, []);

  return (
    <div className="flow">
      <header className="flow__header">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Offices</span>
          <h1 className="flow__title font-display">Standing work, on a schedule.</h1>
        </div>
        <span
          className="chat__note"
          title={
            IS_MOCK
              ? "Office CRUD and runs are served by the in-memory mock. Runs synthesize a STATE checkpoint timeline."
              : "Offices are live against the gateway. Each run checkpoints its STATE and returns it here."
          }
        >
          <Info size={13} />
          {IS_MOCK ? "Mock adapter" : "Live"}
        </span>
      </header>

      <div className="flow__body scroll-quiet">
        <div className="flow__inner">
          {openRun ? (
            <RunTimeline run={openRun} onBack={() => setOpenRun(null)} />
          ) : (
            <>
              <div className="office-bar">
                <p className="office-bar__lede">
                  Each office wakes on its schedule, works its brief, and checkpoints its STATE between runs.
                </p>
                <Button variant="primary" onClick={() => { setInitialBrief(""); setCreating(true); }}>
                  <Plus size={15} weight="bold" />
                  New office
                </Button>
              </div>

              {offices === null ? (
                <div className="think-dots" aria-label="Loading"><span /><span /><span /></div>
              ) : offices.length === 0 ? (
                <Panel raised className="office-empty">
                  <span className="placeholder__mark" style={{ marginBottom: "var(--v-space-3)" }}>
                    <Buildings size={24} />
                  </span>
                  <p className="office-empty__title font-display">No offices yet</p>
                  <p className="office-empty__sub">Create one, or branch a conversation into an office to carry its context as the brief.</p>
                </Panel>
              ) : (
                <div className="office-grid">
                  {offices.map((o) => (
                    <OfficeCard
                      key={o.id}
                      office={o}
                      busy={busyId === o.id}
                      onRun={() => run(o)}
                      onOpen={() => openLast(o)}
                      onDelete={() => remove(o.id)}
                    />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Modal open={creating} onClose={() => setCreating(false)} title="New office">
        <OfficeForm
          initialBrief={initialBrief}
          onCancel={() => setCreating(false)}
          onCreate={create}
        />
      </Modal>
    </div>
  );
}
