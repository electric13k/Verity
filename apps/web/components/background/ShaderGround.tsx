"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/components/shell/ThemeProvider";
import { createAmbientRenderer, type AmbientRenderer, type Palette } from "./ambientRenderer";

// The WebGL ambient ground. This component (and the renderer + GLSL it pulls
// in) is code-split behind AmbientMesh's next/dynamic(ssr:false) boundary, so
// none of it touches first paint or the chat path.
//
// It owns the whole respect budget:
//   • DPR + frame-rate capped inside the renderer
//   • paused when the tab is hidden (visibilitychange)
//   • paused when the canvas is offscreen (IntersectionObserver)
//   • prefers-reduced-motion → ONE static frame, no rAF loop ever
//   • WebGL2 unavailable or context lost → renders nothing; the CSS mesh
//     underneath shows through (degrade never dies)

/**
 * Read the live palette off the token CSS vars (source of truth), so the
 * ground tracks the design system automatically. Falls back to the exact
 * tokens.json hexes if a var can't be resolved yet.
 */
function readPalette(resolved: "light" | "dark"): Palette {
  const FALLBACK = {
    light: {
      base: "#F6F4EE",
      bone: "#FDFCF8",
      matcha: "#56694B",
      chai: "#A97E4F",
      brass: "#8C7349",
    },
    dark: {
      base: "#101210",
      bone: "#181B17",
      matcha: "#A8C48E",
      chai: "#DFB98A",
      brass: "#C9AE7C",
    },
  }[resolved];

  const cs = typeof window !== "undefined" ? getComputedStyle(document.documentElement) : null;
  const pick = (varName: string, fb: string) => {
    const v = cs?.getPropertyValue(varName).trim();
    return hexToRgb(v && v.startsWith("#") ? v : fb);
  };

  return {
    base: pick("--v-porcelain", FALLBACK.base),
    bone: pick("--v-bone", FALLBACK.bone),
    matcha: pick("--v-matcha", FALLBACK.matcha),
    chai: pick("--v-chai", FALLBACK.chai),
    brass: pick("--v-brass", FALLBACK.brass),
    dark: resolved === "dark" ? 1 : 0,
  };
}

function hexToRgb(hex: string): [number, number, number] {
  let h = hex.replace("#", "");
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export default function ShaderGround() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<AmbientRenderer | null>(null);
  const { resolved } = useTheme();
  const [active, setActive] = useState(false);

  // Keep a ref of the resolved theme so the setup effect can read the current
  // value without re-running (it must run exactly once).
  const resolvedRef = useRef(resolved);
  resolvedRef.current = resolved;

  // Setup + teardown. Runs once; theme is applied by the separate effect below.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const renderer = createAmbientRenderer(canvas);
    if (!renderer) {
      // No WebGL2 → leave `active` false; the CSS mesh remains the ground.
      setActive(false);
      return;
    }
    rendererRef.current = renderer;
    renderer.setPalette(readPalette(resolvedRef.current));
    renderer.resize();
    setActive(true);

    const reduceMq = window.matchMedia("(prefers-reduced-motion: reduce)");
    let visible = true; // canvas intersecting the viewport

    // The single source of truth for "should the loop run right now".
    const sync = () => {
      const r = rendererRef.current;
      if (!r) return;
      if (reduceMq.matches) {
        r.stop();
        r.renderOnce(); // one settled frame, zero animation
        return;
      }
      if (visible && !document.hidden) r.start();
      else r.stop();
    };

    const onVisibility = () => sync();
    const onReduceChange = () => sync();
    const onResize = () => {
      const r = rendererRef.current;
      if (!r) return;
      r.resize();
      if (!r.running) r.renderOnce(); // keep a static frame current while paused
    };
    const onLost = (e: Event) => {
      e.preventDefault();
      rendererRef.current?.stop();
      setActive(false); // reveal the CSS mesh beneath
    };

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
        sync();
      },
      { threshold: 0 },
    );
    io.observe(canvas);

    document.addEventListener("visibilitychange", onVisibility);
    reduceMq.addEventListener("change", onReduceChange);
    window.addEventListener("resize", onResize);
    canvas.addEventListener("webglcontextlost", onLost);

    sync();

    return () => {
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      reduceMq.removeEventListener("change", onReduceChange);
      window.removeEventListener("resize", onResize);
      canvas.removeEventListener("webglcontextlost", onLost);
      renderer.dispose();
      rendererRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-tint on theme change. If paused (reduced-motion / hidden), redraw one
  // frame so the new palette shows immediately.
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setPalette(readPalette(resolved));
    if (!r.running) r.renderOnce();
  }, [resolved]);

  return <canvas ref={canvasRef} className={`mesh__gl${active ? " is-active" : ""}`} aria-hidden="true" />;
}
