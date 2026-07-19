"use client";

import { memo, useMemo, useState } from "react";
import {
  ArrowsClockwise,
  Copy,
  Check,
  PencilSimple,
  WarningCircle,
} from "@phosphor-icons/react";
import { renderMarkdown } from "@/lib/markdown";
import { useApp } from "@/lib/store";
import type { Message } from "@/lib/api/types";
import { ConfidenceChip } from "./ConfidenceChip";
import { BranchMenu } from "./BranchMenu";
import { Button } from "@/components/glass/Button";
import { Textarea } from "@/components/glass/Field";

// One message row. User messages are quiet matcha-tinted bubbles (right,
// editable); assistant messages render sanitized markdown (left) with a meta
// row carrying the confidence chip and — on hover/focus — copy, regenerate,
// and branch. Markdown is parsed whole then DOMPurify'd once (lib/markdown).

function AssistantBody({ content, streaming }: { content: string; streaming?: boolean }) {
  const html = useMemo(() => renderMarkdown(content), [content]);
  if (!content && streaming) {
    return (
      <span className="think-dots" aria-label="Thinking">
        <span /><span /><span />
      </span>
    );
  }
  return (
    <div
      className={clsxProse(streaming)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function clsxProse(streaming?: boolean): string {
  return `prose-verity${streaming ? " stream-caret" : ""}`;
}

export const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
  const { regenerate, editUserMessage, streaming } = useApp();
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(message.content);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      /* clipboard blocked — no-op */
    }
  };

  if (message.role === "user") {
    if (editing) {
      return (
        <div className="msg msg--user v-rise" style={{ width: "100%" }}>
          <div style={{ maxWidth: "min(80%, 42rem)", width: "100%" }}>
            <Textarea
              value={draft}
              autoFocus
              rows={3}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setEditing(false);
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  setEditing(false);
                  void editUserMessage(message.id, draft);
                }
              }}
            />
            <div className="flex justify-end gap-2" style={{ marginTop: "var(--v-space-2)" }}>
              <Button size="sm" variant="quiet" onClick={() => { setDraft(message.content); setEditing(false); }}>
                Cancel
              </Button>
              <Button
                size="sm"
                variant="primary"
                disabled={!draft.trim() || streaming}
                onClick={() => { setEditing(false); void editUserMessage(message.id, draft); }}
              >
                Update &amp; resend
              </Button>
            </div>
          </div>
        </div>
      );
    }
    return (
      <div className="msg msg--user v-rise">
        <div className="msg__bubble-user">{message.content}</div>
        <div className="msg__meta" style={{ justifyContent: "flex-end" }}>
          <div className="msg__actions">
            <button className="msg__act" title="Edit &amp; resend" aria-label="Edit message" disabled={streaming} onClick={() => { setDraft(message.content); setEditing(true); }}>
              <PencilSimple size={15} />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // assistant
  return (
    <div className="msg msg--assistant v-rise">
      <div className="msg__bubble-assistant">
        <AssistantBody content={message.content} streaming={message.streaming} />
        {message.error && (
          <div className="msg__error">
            <WarningCircle size={16} weight="fill" />
            {message.error}
          </div>
        )}
      </div>
      {!message.streaming && (
        <div className="msg__meta">
          {message.confidence && <ConfidenceChip confidence={message.confidence} />}
          <div className="msg__actions">
            <button className="msg__act" title={copied ? "Copied" : "Copy"} aria-label="Copy" onClick={copy}>
              {copied ? <Check size={15} weight="bold" style={{ color: "var(--v-matcha)" }} /> : <Copy size={15} />}
            </button>
            <button className="msg__act" title="Regenerate" aria-label="Regenerate" disabled={streaming} onClick={() => void regenerate(message.id)}>
              <ArrowsClockwise size={15} />
            </button>
            <BranchMenu messageId={message.id} />
          </div>
        </div>
      )}
    </div>
  );
});
