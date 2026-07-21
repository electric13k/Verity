// Smoothing buffer for streamed assistant text.
//
// The gateway can deliver a reply in uneven pieces — a slow token trickle, or a
// burst of several sentences at once. Painting each piece as it lands makes long
// chunks "lurch" in. This buffer holds whatever has arrived and releases it to
// the renderer at a steady WORD cadence, so the reader always sees words appear
// one after another. Under `prefers-reduced-motion` there is no cadence at all:
// text is shown the instant it arrives.

export interface StreamBuffer {
  /** Feed a raw delta from the stream. */
  push(delta: string): void;
  /** Signal the stream is complete; resolves once the last word is revealed. */
  finish(): Promise<void>;
  /** Reveal everything immediately and settle (stop / error). */
  cancel(): void;
}

interface Options {
  onText: (text: string) => void;
  reducedMotion?: boolean;
}

// Base reveal rate (chars/ms) while the stream trickles, and how hard to drain a
// backlog: reveal at least 1/CATCHUP of what is waiting each frame, so a burst
// catches up within a handful of frames instead of running visibly behind.
const SPEED = 0.12;
const CATCHUP = 7;
const MAX_FRAME_MS = 48;

const isSpace = (ch: string) => ch === " " || ch === "\n" || ch === "\t" || ch === "\r";

export function createStreamBuffer({ onText, reducedMotion }: Options): StreamBuffer {
  let full = "";
  let shown = 0;

  const emit = () => onText(full.slice(0, shown));

  // Reduced motion: no rAF, no cadence — the text is the content, shown at once.
  if (reducedMotion) {
    return {
      push(delta) {
        full += delta;
        shown = full.length;
        emit();
      },
      finish() {
        shown = full.length;
        emit();
        return Promise.resolve();
      },
      cancel() {
        shown = full.length;
        emit();
      },
    };
  }

  let raf = 0;
  let last = 0;
  let finished = false;
  let resolveFinish: (() => void) | null = null;

  const stopRaf = () => {
    if (raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };

  const settle = () => {
    stopRaf();
    const r = resolveFinish;
    resolveFinish = null;
    r?.();
  };

  const tick = (now: number) => {
    raf = 0;
    const pending = full.length - shown;
    if (pending > 0) {
      const dt = Math.min(now - last, MAX_FRAME_MS);
      last = now;
      let step = Math.max(1, Math.round(dt * SPEED));
      step = Math.max(step, Math.ceil(pending / CATCHUP));
      let next = Math.min(full.length, shown + step);
      // Extend to the next whitespace so a word never appears half-formed —
      // this is what makes the reveal read word-by-word, not character-jitter.
      while (next < full.length && !isSpace(full[next])) next++;
      shown = next;
      emit();
    }
    if (shown < full.length) {
      raf = requestAnimationFrame(tick);
    } else if (finished) {
      settle();
    }
  };

  const schedule = () => {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(tick);
  };

  return {
    push(delta) {
      full += delta;
      schedule();
    },
    finish() {
      finished = true;
      if (shown >= full.length) {
        emit();
        return Promise.resolve();
      }
      return new Promise<void>((resolve) => {
        resolveFinish = resolve;
        schedule();
      });
    },
    cancel() {
      finished = true;
      stopRaf();
      shown = full.length;
      emit();
      const r = resolveFinish;
      resolveFinish = null;
      r?.();
    },
  };
}
