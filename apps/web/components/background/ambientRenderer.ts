// Raw WebGL2 ambient ground — a single fullscreen fragment pass.
//
// Why raw WebGL2 and not a lib (ogl/three): the ground is ONE fullscreen
// triangle running a fragment shader — a domain-warped fbm fog with a sparse
// scatter of drifting motes, all procedural. There is no geometry, camera, or
// scene graph, so a WebGL library would add bundle weight for abstractions we
// never touch. Hand-rolled keeps this the smallest possible lazy chunk (zero
// added dependencies) and gives us exact control over the perf/respect budget:
// DPR cap, frame-rate cap, pause-when-hidden, reduced-motion single frame, and
// graceful failure. The shaders are inlined below (CSP script-src 'self': no
// external assets, nothing fetched).
//
// This module is only ever reached through ShaderGround, which layout mounts
// via next/dynamic(ssr:false) — so all of this GLSL lives in a deferred chunk,
// never in first paint or the chat path.

export interface Palette {
  /** canvas base — porcelain */
  base: [number, number, number];
  /** raised highlight — bone */
  bone: [number, number, number];
  matcha: [number, number, number];
  chai: [number, number, number];
  brass: [number, number, number];
  /** 0 = light, 1 = dark — drives tint amplitude in-shader */
  dark: number;
}

const VERT = `#version 300 es
precision highp float;
// Fullscreen triangle from gl_VertexID — no vertex buffer needed.
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
void main() { gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }
`;

const FRAG = `#version 300 es
precision highp float;

out vec4 fragColor;

uniform vec2  uRes;     // drawing-buffer size in px
uniform float uTime;    // seconds
uniform vec3  uBase;    // porcelain
uniform vec3  uBone;    // bone highlight
uniform vec3  uMatcha;
uniform vec3  uChai;
uniform vec3  uBrass;
uniform float uDark;    // 0 light / 1 dark
uniform vec2  uFocal;   // focal-glow centre, aspect space

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 345.45));
  p += dot(p, p + 34.345);
  return fract(p.x * p.y);
}

// value noise
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  float a = hash(i);
  float b = hash(i + vec2(1.0, 0.0));
  float c = hash(i + vec2(0.0, 1.0));
  float d = hash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

// 5-octave fbm with a rotate-and-scale between octaves (kills axis artefacts)
float fbm(vec2 p) {
  float v = 0.0, a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = m * p;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float aspect = uRes.x / uRes.y;
  vec2 p = vec2(uv.x * aspect, uv.y);

  float t = uTime * 0.02;

  // Domain warp — fbm of fbm. This is the "liquid" mesh: slow chromatic
  // pigment suspended in gallery light, off a loose diagonal.
  vec2 q = vec2(
    fbm(p * 1.35 + vec2(0.0, t)),
    fbm(p * 1.35 + vec2(5.2, 1.3) - t)
  );
  vec2 r = vec2(
    fbm(p * 1.35 + 1.7 * q + vec2(1.7, 9.2) + t * 0.6),
    fbm(p * 1.35 + 1.7 * q + vec2(8.3, 2.8) - t * 0.5)
  );
  float f = fbm(p * 1.35 + 2.0 * r);

  vec3 col = uBase;

  // Three colour fields pooled by the warp channels, placed off-diagonal.
  float wMatcha = smoothstep(0.20, 0.78, r.x * 0.6 + 0.5);
  float wChai   = smoothstep(0.28, 0.88, f);
  float wBrass  = smoothstep(0.32, 0.92, r.y * 0.6 + 0.5) * (0.55 + 0.45 * q.x);

  float amp = mix(0.22, 0.52, uDark); // tint reads far stronger against near-black
  col = mix(col, uMatcha, wMatcha * amp);
  col = mix(col, uChai,   wChai  * amp * 0.9);
  col = mix(col, uBrass,  wBrass * amp * 0.7);

  // Bone highlight where the fog thins — the light catching a ridge.
  col = mix(col, uBone, smoothstep(0.55, 1.0, clamp(f * 1.15, 0.0, 1.0)) * mix(0.5, 0.16, uDark));

  // ONE focal glow (design rule: glow does hierarchy's job, one per view).
  // A soft warm bloom off-centre, toward where content sits.
  float d = length(p - uFocal);
  float glow = exp(-d * d * 3.0);
  vec3 glowCol = mix(uMatcha, uBone, 0.4);
  col += glowCol * glow * mix(0.10, 0.16, uDark);

  // Sparse drifting motes — dust in a sunbeam, gallery register (not a
  // starfield): few, soft, slow, low-opacity, brass/chai tinted.
  float motes = 0.0;
  for (int i = 0; i < 14; i++) {
    float fi = float(i);
    vec2 seed = vec2(hash(vec2(fi, 1.3)), hash(vec2(fi, 7.7)));
    vec2 mp = fract(seed + vec2(0.018 * sin(t * 0.7 + fi), 0.05 * t * (0.5 + seed.x)));
    mp.x *= aspect;
    float s = 0.006 + 0.008 * seed.y;
    motes += smoothstep(s, 0.0, length(p - mp)) * (0.35 + 0.65 * seed.x);
  }
  col += mix(uBrass, uChai, 0.5) * motes * mix(0.05, 0.10, uDark);

  // Vignette — settle the edges into the canvas.
  float vig = smoothstep(1.28, 0.32, length((uv - 0.5) * vec2(1.08, 1.0)));
  col = mix(col, uBase, (1.0 - vig) * mix(0.34, 0.5, uDark));

  // Ordered-ish dither — the single most important line for killing 8-bit
  // banding across a smooth gradient fog.
  col += (hash(gl_FragCoord.xy + fract(t)) - 0.5) / 255.0;

  fragColor = vec4(col, 1.0);
}
`;

function compile(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader | null {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    gl.deleteShader(sh);
    return null;
  }
  return sh;
}

export interface AmbientRenderer {
  setPalette(p: Palette): void;
  resize(): void;
  start(): void;
  stop(): void;
  /** Draw exactly one frame (reduced-motion / theme change while paused). */
  renderOnce(): void;
  get running(): boolean;
  dispose(): void;
}

/**
 * Create the renderer, or return null if a WebGL2 context can't be made —
 * the caller then degrades to the CSS mesh (degrade never dies).
 */
export function createAmbientRenderer(canvas: HTMLCanvasElement): AmbientRenderer | null {
  const gl = canvas.getContext("webgl2", {
    alpha: false, // opaque ground — cheaper compositing, and it covers the CSS fallback
    antialias: false, // a fog needs no MSAA; save the fill cost
    depth: false,
    stencil: false,
    powerPreference: "low-power", // ambient chrome must never spin up the discrete GPU
    preserveDrawingBuffer: false,
    failIfMajorPerformanceCaveat: false,
  });
  if (!gl) return null;

  const vs = compile(gl, gl.VERTEX_SHADER, VERT);
  const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;

  const prog = gl.createProgram();
  if (!prog) return null;
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    gl.deleteProgram(prog);
    return null;
  }
  gl.useProgram(prog);

  const U = {
    res: gl.getUniformLocation(prog, "uRes"),
    time: gl.getUniformLocation(prog, "uTime"),
    base: gl.getUniformLocation(prog, "uBase"),
    bone: gl.getUniformLocation(prog, "uBone"),
    matcha: gl.getUniformLocation(prog, "uMatcha"),
    chai: gl.getUniformLocation(prog, "uChai"),
    brass: gl.getUniformLocation(prog, "uBrass"),
    dark: gl.getUniformLocation(prog, "uDark"),
    focal: gl.getUniformLocation(prog, "uFocal"),
  };

  const DPR_CAP = 1.5;
  const FRAME_MS = 1000 / 32; // ambient ground runs at ~32fps, not 60 — halves GPU

  let raf = 0;
  let running = false;
  let startMs = 0;
  let lastDraw = 0;

  function draw(seconds: number) {
    gl!.uniform1f(U.time, seconds);
    gl!.drawArrays(gl!.TRIANGLES, 0, 3);
  }

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, DPR_CAP);
    const w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl!.viewport(0, 0, w, h);
    gl!.uniform2f(U.res, w, h);
    // Focal glow off a loose diagonal (uv ~0.7, 0.34), aspect-corrected.
    gl!.uniform2f(U.focal, 0.7 * (w / h), 0.34);
  }

  function loop(now: number) {
    if (!running) return;
    raf = requestAnimationFrame(loop);
    if (now - lastDraw < FRAME_MS) return; // frame-rate cap
    lastDraw = now;
    draw((now - startMs) / 1000);
  }

  return {
    setPalette(p: Palette) {
      gl.uniform3fv(U.base, p.base);
      gl.uniform3fv(U.bone, p.bone);
      gl.uniform3fv(U.matcha, p.matcha);
      gl.uniform3fv(U.chai, p.chai);
      gl.uniform3fv(U.brass, p.brass);
      gl.uniform1f(U.dark, p.dark);
    },
    resize,
    start() {
      if (running) return;
      running = true;
      // Fresh clock on each resume — for a slow fbm fog the phase reset is
      // imperceptible, and it keeps the frame-cap accumulator honest.
      startMs = performance.now();
      lastDraw = 0;
      raf = requestAnimationFrame(loop);
    },
    stop() {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    },
    renderOnce() {
      // A settled, pleasant static composition — used under reduced motion and
      // to reflect a theme change while paused. No loop is started.
      resize();
      draw(38.0);
    },
    get running() {
      return running;
    },
    dispose() {
      // Stop the loop and release this program's GL objects. We deliberately do
      // NOT call WEBGL_lose_context.loseContext(): a canvas hands back the same
      // context on every getContext('webgl2'), so losing it would poison any
      // remount (React Strict Mode's mount→unmount→remount, or a navigation
      // that re-mounts the shell) — the next createAmbientRenderer would get a
      // dead context. Freeing the program is enough; the context is reclaimed
      // with the canvas. In production this lives in the root layout and never
      // unmounts anyway.
      running = false;
      if (raf) cancelAnimationFrame(raf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    },
  };
}
