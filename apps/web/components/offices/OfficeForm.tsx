"use client";

import { useState } from "react";
import { Minus, Plus, Check } from "@phosphor-icons/react";
import { Input, Textarea } from "@/components/glass/Field";
import { Button } from "@/components/glass/Button";
import type { FlowKind, OfficeInput } from "@/lib/api/types";
import { humanizeCron } from "./status";

// The create form. An office is a standing task with a clock: name it, give it
// a schedule (or leave it manual), write the brief it works each run, and set
// how it runs. Presets keep cron out of the user's way; the field stays for
// anyone who wants it.

const SCHEDULE_PRESETS: { label: string; expr: string }[] = [
  { label: "Manual", expr: "" },
  { label: "Every weekday, 7am", expr: "0 7 * * 1-5" },
  { label: "Daily, 9am", expr: "0 9 * * *" },
  { label: "Mondays, 9am", expr: "0 9 * * 1" },
];

const KINDS: { value: "" | FlowKind; label: string }[] = [
  { value: "", label: "Auto" },
  { value: "converge", label: "Converge" },
  { value: "diverge_converge", label: "Diverge · converge" },
];

export function OfficeForm({
  initialBrief = "",
  onCancel,
  onCreate,
}: {
  initialBrief?: string;
  onCancel: () => void;
  onCreate: (input: OfficeInput) => void;
}) {
  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("0 7 * * 1-5");
  const [brief, setBrief] = useState(initialBrief);
  const [kind, setKind] = useState<"" | FlowKind>("");
  const [workers, setWorkers] = useState(2);

  const canCreate = name.trim().length > 0 && brief.trim().length > 0;

  return (
    <form
      className="office-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (canCreate) onCreate({ name, schedule, brief, flow_kind: kind, workers });
      }}
    >
      <label className="field-row">
        <span className="eyebrow">Name</span>
        <Input
          value={name}
          autoFocus
          placeholder="Morning market briefing"
          onChange={(e) => setName(e.target.value)}
        />
      </label>

      <label className="field-row">
        <span className="eyebrow">Brief · the standing task</span>
        <Textarea
          value={brief}
          rows={3}
          placeholder="What this office should produce every time it runs."
          onChange={(e) => setBrief(e.target.value)}
        />
      </label>

      <div className="field-row">
        <span className="eyebrow">Schedule</span>
        <div className="chip-row">
          {SCHEDULE_PRESETS.map((p) => (
            <button
              key={p.label}
              type="button"
              className={`gchip${schedule === p.expr ? " gchip--on" : ""}`}
              onClick={() => setSchedule(p.expr)}
            >
              {schedule === p.expr && <Check size={12} weight="bold" />}
              {p.label}
            </button>
          ))}
        </div>
        <Input
          value={schedule}
          placeholder="cron, or leave blank for manual"
          onChange={(e) => setSchedule(e.target.value)}
          style={{ marginTop: "var(--v-space-2)", fontFamily: "var(--v-font-mono)", fontSize: "0.8125rem" }}
          aria-label="Cron expression"
        />
        <span className="field-hint">{humanizeCron(schedule)}</span>
      </div>

      <div className="office-form__split">
        <div className="field-row">
          <span className="eyebrow">Flow</span>
          <div className="chip-row">
            {KINDS.map((k) => (
              <button
                key={k.value || "auto"}
                type="button"
                className={`gchip${kind === k.value ? " gchip--on" : ""}`}
                onClick={() => setKind(k.value)}
              >
                {k.label}
              </button>
            ))}
          </div>
        </div>
        <div className="field-row">
          <span className="eyebrow">Workers</span>
          <div className="flow-stepper" role="group" aria-label="Workers">
            <button type="button" className="flow-stepper__btn" aria-label="Fewer workers" disabled={workers <= 1} onClick={() => setWorkers((w) => Math.max(1, w - 1))}>
              <Minus size={12} weight="bold" />
            </button>
            <span className="flow-stepper__val">{workers} <span className="flow-stepper__unit">{workers === 1 ? "worker" : "workers"}</span></span>
            <button type="button" className="flow-stepper__btn" aria-label="More workers" disabled={workers >= 4} onClick={() => setWorkers((w) => Math.min(4, w + 1))}>
              <Plus size={12} weight="bold" />
            </button>
          </div>
        </div>
      </div>

      <div className="office-form__actions">
        <Button variant="quiet" size="sm" type="button" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" type="submit" disabled={!canCreate}>Create office</Button>
      </div>
    </form>
  );
}
