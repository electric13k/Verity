// Assistant markdown → sanitized HTML. Parse the whole block first, then run
// DOMPurify ONCE on the result (plan §2: sanitize post-parse, not per-chunk).
// Called only in the browser (message rendering is client-side).

import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({ gfm: true, breaks: true });

export function renderMarkdown(src: string): string {
  const html = marked.parse(src, { async: false }) as string;
  if (typeof window === "undefined") return html; // never runs at build time
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: [
      "p", "br", "hr", "strong", "em", "del", "code", "pre", "blockquote",
      "ul", "ol", "li", "a", "h1", "h2", "h3", "h4",
      "table", "thead", "tbody", "tr", "th", "td", "span",
    ],
    ALLOWED_ATTR: ["href", "title"],
    ALLOW_DATA_ATTR: false,
    ADD_ATTR: ["target", "rel"],
  });
}
