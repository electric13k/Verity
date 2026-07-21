"use client";

// Assistant markdown → sanitized HTML.
//
// `marked` and DOMPurify are the heaviest leaves in the message renderer, and
// nothing on first paint needs them: a new chat is empty, and a streaming reply
// shows plaintext until it settles. So they load on demand — the first message
// that needs a parse triggers one dynamic import, and every render after is
// synchronous. Sanitization still runs ONCE on the fully-parsed HTML (never per
// chunk, never on unsanitized mid-stream text).

import { useEffect, useMemo, useState } from "react";

type MarkedFn = (typeof import("marked"))["marked"];
type PurifyApi = (typeof import("dompurify"))["default"];

let mods: { marked: MarkedFn; purify: PurifyApi } | null = null;
let pending: Promise<void> | null = null;

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    "p", "br", "hr", "strong", "em", "del", "code", "pre", "blockquote",
    "ul", "ol", "li", "a", "h1", "h2", "h3", "h4",
    "table", "thead", "tbody", "tr", "th", "td", "span",
  ],
  ALLOWED_ATTR: ["href", "title"],
  ALLOW_DATA_ATTR: false,
  ADD_ATTR: ["target", "rel"],
};

export function markdownReady(): boolean {
  return mods !== null;
}

// Memoized dynamic import of marked + DOMPurify. Safe to call repeatedly.
export function loadMarkdown(): Promise<void> {
  if (mods) return Promise.resolve();
  if (!pending) {
    pending = Promise.all([import("marked"), import("dompurify")]).then(
      ([m, d]) => {
        m.marked.setOptions({ gfm: true, breaks: true });
        mods = { marked: m.marked, purify: d.default };
      },
    );
  }
  return pending;
}

// Parse + sanitize. Returns null until the module has loaded (callers render a
// plaintext fallback meanwhile) and at build time, where there is no window for
// DOMPurify — message rendering is a browser-only concern.
export function renderMarkdown(src: string): string | null {
  if (!mods || typeof window === "undefined") return null;
  const html = mods.marked.parse(src, { async: false }) as string;
  return mods.purify.sanitize(html, PURIFY_CONFIG);
}

// Render `src` to sanitized HTML, loading the renderer on first use. Returns
// null while the module is still loading; the caller shows the raw text (which
// is already readable) until markdown is ready, so there is no blocking wait and
// nothing unsanitized is ever injected as HTML.
export function useMarkdown(src: string, enabled = true): string | null {
  const [ready, setReady] = useState(markdownReady());

  useEffect(() => {
    if (!enabled || ready) return;
    let alive = true;
    loadMarkdown().then(() => {
      if (alive) setReady(true);
    });
    return () => {
      alive = false;
    };
  }, [enabled, ready]);

  return useMemo(
    () => (enabled && ready ? renderMarkdown(src) : null),
    [enabled, ready, src],
  );
}
