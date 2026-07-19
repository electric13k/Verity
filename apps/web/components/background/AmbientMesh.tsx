"use client";

// Ambient gradient-mesh ground. Liquid glass is invisible over a flat fill
// (v1 law), so both themes ship a chromatic backdrop from day one: three
// slow-drifting color fields (matcha / chai / brass), a paper grain, and a
// vignette that settles the edges. The drift is the single permitted idle
// loop — GPU-cheap transforms, silenced under prefers-reduced-motion by the
// rules in globals.css. Colors ride the token vars, so the ground re-tints
// with the theme automatically.

interface Blob {
  color: string;
  size: string;
  top: string;
  left: string;
  dx: string;
  dy: string;
  delay: string;
}

// Placed off a loose diagonal so the ground reads composed, not centered —
// the same editorial asymmetry the shell uses.
const BLOBS: Blob[] = [
  { color: "var(--v-matcha)", size: "46vw", top: "-8%", left: "-6%", dx: "5%", dy: "4%", delay: "0s" },
  { color: "var(--v-chai)", size: "40vw", top: "44%", left: "58%", dx: "-6%", dy: "-3%", delay: "-8s" },
  { color: "var(--v-brass)", size: "30vw", top: "68%", left: "8%", dx: "4%", dy: "-5%", delay: "-18s" },
];

export function AmbientMesh() {
  return (
    <div className="mesh" aria-hidden="true">
      {BLOBS.map((b, i) => (
        <div
          key={i}
          className="mesh__blob"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${b.color}, transparent 68%)`,
            width: b.size,
            height: b.size,
            top: b.top,
            left: b.left,
            // consumed by the v-blob-drift keyframes
            ["--dx" as string]: b.dx,
            ["--dy" as string]: b.dy,
            animationDelay: b.delay,
          }}
        />
      ))}
      <div className="mesh__grain" />
      <div className="mesh__vignette" />
    </div>
  );
}
