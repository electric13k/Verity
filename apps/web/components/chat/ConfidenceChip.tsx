"use client";

import { useId } from "react";
import type { Confidence, ConfidenceBand } from "@/lib/api/types";

// The signature device. Verity's thesis is that every answer carries a read on
// its own certainty, so the chip is a small ring gauge — the arc fills to the
// score and takes the band's warm color (never a traffic light). Assured =
// matcha, measured = chai, tentative = brass. The rationale rides `title`.

const BAND: Record<ConfidenceBand, { label: string; color: string }> = {
  assured: { label: "Assured", color: "var(--v-matcha)" },
  measured: { label: "Measured", color: "var(--v-chai)" },
  tentative: { label: "Tentative", color: "var(--v-brass)" },
};

export function ConfidenceChip({ confidence }: { confidence: Confidence }) {
  const id = useId();
  const { score, band, rationale } = confidence;
  const { label, color } = BAND[band];
  const r = 6.5;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;

  return (
    <span
      className="gchip"
      title={rationale ? `${label} · ${score}% — ${rationale}` : `${label} · ${score}% confidence`}
      style={{ borderColor: `color-mix(in oklab, ${color} 40%, transparent)` }}
    >
      <svg width="17" height="17" viewBox="0 0 17 17" aria-hidden="true" style={{ transform: "rotate(-90deg)", flex: "none" }}>
        <circle cx="8.5" cy="8.5" r={r} fill="none" stroke="currentColor" strokeOpacity="0.18" strokeWidth="2" />
        <circle
          cx="8.5"
          cy="8.5"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          id={id}
        />
      </svg>
      <span style={{ color }}>{label}</span>
      <span style={{ opacity: 0.6 }}>{score}%</span>
    </span>
  );
}
