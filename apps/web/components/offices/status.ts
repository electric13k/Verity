import type { OfficeStatus } from "@/lib/api/types";

// One place that maps an office/run status to its label + dot color, so the
// list chip, the run header, and the timeline never drift.
export const STATUS_META: Record<OfficeStatus, { label: string; color: string }> = {
  idle: { label: "Manual", color: "var(--v-fog)" },
  scheduled: { label: "Scheduled", color: "var(--v-chai)" },
  running: { label: "Running", color: "var(--v-matcha)" },
  done: { label: "Done", color: "var(--v-matcha)" },
  failed: { label: "Failed", color: "var(--v-oxblood)" },
};

// A cron expression, said plainly. Covers the shapes offices actually use
// (daily / weekday / weekly at a time); anything else falls back to the raw
// expression so we never lie about the schedule.
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function humanizeCron(expr: string): string {
  const trimmed = expr.trim();
  if (!trimmed) return "Manual only";
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return trimmed;
  const [min, hour, dom, , dow] = parts;
  const h = Number(hour);
  const m = Number(min);
  if (Number.isNaN(h) || Number.isNaN(m)) return trimmed;
  const time = `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;

  let when = "";
  if (dow === "1-5") when = "weekdays";
  else if (dow === "*" && dom === "*") when = "daily";
  else if (/^\d$/.test(dow)) when = DOW[Number(dow)] ? `${DOW[Number(dow)]}s` : "weekly";
  else if (dom !== "*") when = `day ${dom} monthly`;
  else return trimmed;

  return `${when.charAt(0).toUpperCase()}${when.slice(1)} at ${time}`;
}
