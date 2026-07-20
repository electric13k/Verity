"use client";

import { useEffect, useMemo, useState } from "react";
import { Printer, LockSimple } from "@phosphor-icons/react";
import { api } from "@/lib/api/client";
import { renderMarkdown } from "@/lib/markdown";
import type { Message, Transcript } from "@/lib/api/types";

// Public, read-only shared transcript (GET /v1/transcripts/:share_id, fetched
// live by share id). No workspace, no store: a share never loads the app.
// Print-clean — the print stylesheet drops the chrome and lays the thread out
// on white. An unknown/revoked id resolves to the graceful not-found state.

function TurnBody({ message }: { message: Message }) {
  const html = useMemo(() => renderMarkdown(message.content), [message.content]);
  if (message.role === "user") {
    return <div className="t-turn__user">{message.content}</div>;
  }
  return <div className="prose-verity" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function TranscriptView({ shareId }: { shareId: string }) {
  const [state, setState] = useState<{ t: Transcript | null; loading: boolean }>({ t: null, loading: true });

  useEffect(() => {
    let live = true;
    api.getTranscript(shareId).then((t) => live && setState({ t, loading: false }));
    return () => { live = false; };
  }, [shareId]);

  if (state.loading) {
    return (
      <div className="t-page">
        <div className="t-doc"><div className="think-dots" aria-label="Loading"><span /><span /><span /></div></div>
      </div>
    );
  }

  if (!state.t) {
    return (
      <div className="t-page">
        <div className="t-doc t-doc--missing">
          <span className="font-display" style={{ fontSize: "1.5rem" }}>Verity</span>
          <h1 className="t-missing__title font-display">This transcript isn’t available.</h1>
          <p className="t-missing__sub">The share link may have been revoked, or it never existed.</p>
        </div>
      </div>
    );
  }

  const t = state.t;
  return (
    <div className="t-page scroll-quiet">
      <article className="t-doc">
        <header className="t-doc__head">
          <div className="t-doc__brand">
            <span className="font-display" style={{ fontSize: "1.25rem", fontWeight: 500 }}>Verity</span>
            <span className="eyebrow" style={{ fontSize: "0.5625rem" }}>Shared transcript</span>
          </div>
          <button type="button" className="gbtn gbtn--quiet gbtn--sm t-doc__print" onClick={() => window.print()}>
            <Printer size={14} />
            Print
          </button>
        </header>

        <h1 className="t-doc__title font-display">{t.title}</h1>
        <div className="t-doc__meta">
          <span><LockSimple size={12} weight="fill" /> Read-only</span>
          <span>{new Date(t.created_at).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}</span>
        </div>

        <div className="t-thread">
          {t.messages.map((m) => (
            <section key={m.id} className={`t-turn t-turn--${m.role}`}>
              <span className="eyebrow t-turn__who">{m.role === "user" ? "Asked" : "Verity"}</span>
              <TurnBody message={m} />
            </section>
          ))}
        </div>

        <footer className="t-doc__foot">
          <span className="eyebrow">Rendered by Verity</span>
        </footer>
      </article>
    </div>
  );
}
