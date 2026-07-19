"use client";

import { useCallback, useState } from "react";
import { api } from "@/lib/api/client";
import type { Attachment } from "@/lib/api/types";

// Attachment lifecycle, owned locally by the composer. Each dropped/picked file
// is uploaded through the typed client (POST /v1/upload → markitdown; mock
// today), moving uploading → parsed (with its markdown size) or → error.

let seq = 0;
const localId = () => `att_${Date.now().toString(36)}${(seq++).toString(36)}`;

export function useAttachments() {
  const [items, setItems] = useState<Attachment[]>([]);

  const patch = useCallback((id: string, p: Partial<Attachment>) => {
    setItems((prev) => prev.map((a) => (a.local_id === id ? { ...a, ...p } : a)));
  }, []);

  const add = useCallback(
    (files: File[]) => {
      for (const file of files) {
        const id = localId();
        setItems((prev) => [...prev, { local_id: id, name: file.name, size: file.size, status: "uploading" }]);
        api
          .upload({ name: file.name, size: file.size })
          .then((res) => patch(id, { status: "parsed", markdown_bytes: res.markdown_bytes, file_id: res.file_id }))
          .catch(() => patch(id, { status: "error", error: "Couldn’t parse this file." }));
      }
    },
    [patch],
  );

  const remove = useCallback((id: string) => {
    setItems((prev) => prev.filter((a) => a.local_id !== id));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  return { items, add, remove, clear };
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentChips({
  items,
  onRemove,
}: {
  items: Attachment[];
  onRemove: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="attach-row">
      {items.map((a) => (
        <span key={a.local_id} className={`attach-chip attach-chip--${a.status}`}>
          <span className="attach-chip__name">{a.name}</span>
          <span className="attach-chip__meta">
            {a.status === "uploading" && <span className="think-dots" aria-label="Parsing"><span /><span /><span /></span>}
            {a.status === "parsed" && `${formatBytes(a.markdown_bytes ?? 0)} md`}
            {a.status === "error" && (a.error ?? "Failed")}
          </span>
          <button
            type="button"
            className="attach-chip__x"
            aria-label={`Remove ${a.name}`}
            onClick={() => onRemove(a.local_id)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  );
}
