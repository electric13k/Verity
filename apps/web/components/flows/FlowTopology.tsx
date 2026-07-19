"use client";

// The topology glyph — the flow's shape drawn as its actual graph: one task
// fans into N workers, which merge into one answer. Converge splits the task
// into subtasks; diverge-converge runs the whole task from N angles. The
// picture IS the converge/diverge indicator (structure is information), so it
// re-draws with the worker count and the chosen kind.

import type { FlowKind } from "@/lib/api/types";

export function FlowTopology({
  kind,
  workers,
  muted,
}: {
  kind: FlowKind;
  workers: number;
  muted?: boolean;
}) {
  const n = Math.max(1, Math.min(4, workers));
  const W = 208;
  const H = 132;
  const xTask = 26;
  const xWork = 104;
  const xOut = 182;
  const midY = H / 2;
  const gap = 26;
  const top = midY - ((n - 1) * gap) / 2;
  const ys = Array.from({ length: n }, (_, i) => top + i * gap);
  const diverge = kind === "diverge_converge";

  return (
    <figure className={`flow-topo${muted ? " flow-topo--muted" : ""}`} aria-hidden="true">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height="100%" role="img">
        {/* connectors */}
        <g stroke="rgb(var(--hairline) / 0.5)" strokeWidth="1.25" fill="none" strokeDasharray={diverge ? "3 3" : undefined}>
          {ys.map((y, i) => (
            <path key={`in-${i}`} d={`M ${xTask + 7} ${midY} C ${xWork - 24} ${midY}, ${xWork - 24} ${y}, ${xWork - 9} ${y}`} />
          ))}
          {ys.map((y, i) => (
            <path key={`out-${i}`} d={`M ${xWork + 9} ${y} C ${xOut - 24} ${y}, ${xOut - 24} ${midY}, ${xOut - 7} ${midY}`} />
          ))}
        </g>
        {/* task node */}
        <circle cx={xTask} cy={midY} r="7" fill="var(--v-matcha)" />
        {/* worker nodes */}
        {ys.map((y, i) => (
          <g key={`w-${i}`}>
            <circle cx={xWork} cy={y} r="6" fill="none" stroke="var(--v-brass)" strokeWidth="1.5" />
            <circle cx={xWork} cy={y} r="2.4" fill="var(--v-brass)" />
          </g>
        ))}
        {/* converge node */}
        <circle cx={xOut} cy={midY} r="7" fill="var(--v-chai)" />
      </svg>
      <figcaption className="flow-topo__cap">
        {diverge ? `${n} angles → merge` : `split → ${n} → merge`}
      </figcaption>
    </figure>
  );
}
