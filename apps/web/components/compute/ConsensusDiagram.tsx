// Redundancy-2 consensus, drawn as its actual shape: one work unit dispatches
// to two independent nodes; their results are compared; agreement is what makes
// the answer count. The picture is the explanation (structure is information).

export function ConsensusDiagram() {
  return (
    <svg viewBox="0 0 300 132" width="100%" height="100%" role="img" aria-label="One work unit runs on two independent nodes; matching results reach consensus and are accepted.">
      <g stroke="rgb(var(--hairline) / 0.5)" strokeWidth="1.25" fill="none">
        <path d="M 40 66 C 78 66, 78 38, 120 38" />
        <path d="M 40 66 C 78 66, 78 94, 120 94" />
        <path d="M 156 38 C 200 38, 200 66, 238 66" />
        <path d="M 156 94 C 200 94, 200 66, 238 66" />
      </g>
      {/* work unit */}
      <circle cx="34" cy="66" r="8" fill="var(--v-matcha)" />
      {/* two nodes */}
      <g>
        <circle cx="138" cy="38" r="7" fill="none" stroke="var(--v-brass)" strokeWidth="1.5" />
        <circle cx="138" cy="38" r="2.6" fill="var(--v-brass)" />
        <circle cx="138" cy="94" r="7" fill="none" stroke="var(--v-brass)" strokeWidth="1.5" />
        <circle cx="138" cy="94" r="2.6" fill="var(--v-brass)" />
      </g>
      {/* consensus */}
      <circle cx="244" cy="66" r="8" fill="var(--v-chai)" />
      <text x="34" y="92" textAnchor="middle" className="consensus-diagram__t">unit</text>
      <text x="138" y="18" textAnchor="middle" className="consensus-diagram__t">node A</text>
      <text x="138" y="118" textAnchor="middle" className="consensus-diagram__t">node B</text>
      <text x="244" y="92" textAnchor="middle" className="consensus-diagram__t">agree</text>
    </svg>
  );
}
