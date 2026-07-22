"use client";

import dynamic from "next/dynamic";

// Ambient ground. A real WebGL shader ground (domain-warped fbm fog + drifting
// motes, in the brand palette) rides ON TOP of a CSS gradient-mesh base. The
// CSS layer is the guaranteed floor: it paints instantly (no first-paint cost),
// and it is exactly what remains visible if WebGL is unavailable, the context
// is lost, or reduced-motion trims things back. The shader is lazy-loaded, so
// none of its GLSL touches first paint or the chat path (M4 perf discipline).
//
// Liquid glass is invisible over a flat fill (v1 law), so both themes ship a
// chromatic backdrop from day one — light and dark are equal citizens, tinted
// from the tokens by the shader (and by the CSS vars for the fallback layer).
//
// Public API is unchanged (`<AmbientMesh />`, no props) — the shell mounts it
// once in layout; only the internals were swapped.

// Code-split boundary: the shader + renderer travel in their own deferred chunk.
const ShaderGround = dynamic(() => import("./ShaderGround"), { ssr: false });

interface Blob {
  color: string;
  size: string;
  top: string;
  left: string;
  dx: string;
  dy: string;
  delay: string;
}

// CSS fallback ground — three slow color fields off a loose diagonal. Shown
// until (and unless) the shader takes over; the shader's opaque canvas covers
// these when active, and `.mesh:has(.is-active)` parks their drift so only one
// ground ever animates.
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
      <ShaderGround />
    </div>
  );
}
