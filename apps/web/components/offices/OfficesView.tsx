"use client";

import { useCallback, useEffect, useState } from "react";
import { Info, Plus, Play, Clock, TrashSimple, ArrowRight, Buildings } from "@phosphor-icons/react";
import { Panel } from "@/components/glass/Panel";
import { Badge } from "@/components/glass/Chip";
import { Modal } from "@/components/glass/Modal";
import { Button } from "@/components/glass/Button";
import { api } from "@/lib/api/client";
import { consumeHandoff } from "@/lib/handoff";
import type { Office, OfficeInput, OfficeRun } from "@/lib/api/types";
import { STATUS_META, humanizeCron } from "./status";
import { OfficeForm } from "./OfficeForm";
import { RunTimeline } from "./RunTimeline";

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

  const run = useCallback(
    async (id: string) => {
      setBusyId(id);
      const { run_id } = await api.runOffice(id);
      setBusyId(null);
      refresh();
      if (run_id) {
        const detail = await api.getOfficeRun(run_id);
        if (detail) setOpenRun(detail);
      }
    },
    [refresh],
  );

  const openLast = useCallback(async (office: Office) => {
    if (!office.last_run_id) return;
    const detail = await api.getOfficeRun(office.last_run_id);
    if (detail) setOpenRun(detail);
  }, []);

  const remove = useCallback(
    async (id: string) => {
      await api.deleteOffice(id);
      refresh();
    },
    [refresh],
  );

  return (
    <div className="flow">
      <header className="flow__header">
        <div style={{ minWidth: 0 }}>
          <span className="eyebrow">Offices</span>
          <h1 className="flow__title font-display">Standing work, on a schedule.</h1>
        </div>
        <span className="chat__note" title="Office CRUD and runs are served by the in-memory mock (API_SURFACE: planned). Runs synthesize a STATE checkpoint timeline.">
          <Info size={13} />
          Mock adapter
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
                      onRun={() => run(o.id)}
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
