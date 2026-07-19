"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUp, Stop, Brain, Paperclip } from "@phosphor-icons/react";
import { clsx } from "clsx";
import { Panel } from "@/components/glass/Panel";
import { useApp } from "@/lib/store";
import { ModelPicker } from "./ModelPicker";
import { useAttachments, AttachmentChips } from "./Attachments";

// The composer is the working surface, so it carries the view's single glow
// while focused (hierarchy = attention). Enter sends, Shift+Enter breaks a
// line. Files can be attached (button) or dropped onto the panel; each is
// parsed to markdown through the typed upload client before it can be sent.

export function Composer() {
  const { send, stop, streaming, useMemory, setUseMemory } = useApp();
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const attachments = useAttachments();

  // Auto-grow up to a ceiling, then scroll inside.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [text]);

  const uploading = attachments.items.some((a) => a.status === "uploading");

  const submit = () => {
    const t = text.trim();
    if ((!t && attachments.items.length === 0) || streaming || uploading) return;
    setText("");
    void send(t);
    attachments.clear();
    requestAnimationFrame(() => ref.current?.focus());
  };

  const onPick = (files: FileList | null) => {
    if (files && files.length) attachments.add(Array.from(files));
  };

  return (
    <Panel
      active
      glow={focused || dragging}
      className={clsx("composer", dragging && "composer--drop")}
      onDragOver={(e: React.DragEvent) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={(e: React.DragEvent) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        onPick(e.dataTransfer.files);
      }}
    >
      <AttachmentChips items={attachments.items} onRemove={attachments.remove} />

      <textarea
        ref={ref}
        className="composer__input scroll-quiet"
        value={text}
        rows={1}
        placeholder={dragging ? "Drop to attach…" : "Ask Verity anything…"}
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
          <input
            ref={fileRef}
            type="file"
            multiple
            hidden
            onChange={(e) => { onPick(e.target.files); e.target.value = ""; }}
          />
          <button
            type="button"
            className="gchip"
            onClick={() => fileRef.current?.click()}
            title="Attach a file — parsed to markdown for context"
            aria-label="Attach a file"
          >
            <Paperclip size={13} />
            Attach
          </button>
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
            disabled={(!text.trim() && attachments.items.length === 0) || uploading}
            aria-label="Send"
          >
            <ArrowUp size={17} weight="bold" />
          </button>
        )}
      </div>
    </Panel>
  );
}
