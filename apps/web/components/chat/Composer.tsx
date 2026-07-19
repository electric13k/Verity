"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Stop, Brain } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { Panel } from "@/components/glass/Panel";
import { useApp } from "@/lib/store";
import { ModelPicker } from "./ModelPicker";

// The composer is the working surface, so it carries the view's single glow
// while focused (hierarchy = attention). Enter sends, Shift+Enter breaks a
// line. The primary button flips send ⇄ stop with the stream state.

export function Composer() {
  const { send, stop, streaming, useMemory, setUseMemory } = useApp();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow up to a ceiling, then scroll inside.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || streaming) return;
    setText("");
    void send(t);
    requestAnimationFrame(() => ref.current?.focus());
  };

  return (
    <Panel active glow={focused} className="composer">
      <textarea
        ref={ref}
        className="composer__input scroll-quiet"
        value={text}
        rows={1}
        placeholder="Ask Verity anything…"
        aria-label="Message"
        onChange={(e) => setText(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="composer__bar">
        <div className="flex items-center gap-2">
          <ModelPicker />
          <button
            type="button"
            className={clsx("gchip", useMemory && "gchip--on")}
            onClick={() => setUseMemory(!useMemory)}
            aria-pressed={useMemory}
            title={useMemory ? "Memory on — this exchange can use and update your brain" : "Memory off — this exchange is isolated"}
          >
            <Brain size={13} weight={useMemory ? "fill" : "regular"} />
            Memory
          </button>
        </div>

        {streaming ? (
          <button type="button" className="gbtn gbtn--quiet gbtn--sm" onClick={stop}>
            <Stop size={15} weight="fill" />
            Stop
          </button>
        ) : (
          <button
            type="button"
            className="gbtn gbtn--primary gbtn--icon"
            onClick={submit}
            disabled={!text.trim()}
            aria-label="Send"
          >
            <ArrowUp size={17} weight="bold" />
          </button>
        )}
      </div>
    </Panel>
  );
}
