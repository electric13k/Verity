"""HTML → clean markdown extraction.

Two modes, both producing markdown in the response's ``markdown`` field:

  * ``readable`` (default; the brain sends ``"markdown"`` which maps here) —
    readability-style main-content extraction (drops nav/ads/boilerplate) then
    HTML→markdown. This is what a reader wants from an article page.
  * ``raw`` (the brain's ``"text"`` maps here) — convert the whole cleaned body
    to markdown without the readability pass, for pages where main-content
    detection would drop wanted structure.

Scripts, styles, and other executable/opaque nodes are stripped in BOTH modes.
The output is DATA: the brain wrapUntrusts it before it re-enters any prompt, and
this service never executes or follows it. We only ever *serialize* it to text.
"""

from __future__ import annotations

import re

from bs4 import BeautifulSoup
from markdownify import markdownify as _md
from readability import Document

# Nodes that carry no readable text and/or are executable/opaque. Removed before
# any conversion so no script/style/handler content reaches the markdown.
_STRIP_TAGS = (
    "script", "style", "noscript", "template", "svg", "canvas",
    "iframe", "object", "embed", "applet", "link", "meta",
)

_READABLE = {"readable", "markdown", "md", "", None}
_MODE_ALIASES = {
    "readable": "readable", "markdown": "readable", "md": "readable",
    "raw": "raw", "text": "raw", "full": "raw",
}


def normalize_mode(mode: str | None) -> str:
    """Map the accepted vocabularies onto the two internal modes. The brain sends
    ``markdown``/``text``; the spec names ``readable``/``raw``; we accept both and
    default to readable."""
    if mode is None:
        return "readable"
    return _MODE_ALIASES.get(str(mode).strip().lower(), "readable")


def apply_size_cap(html: str, max_bytes: int) -> tuple[str, bool]:
    """Truncate ``html`` so its UTF-8 encoding is ≤ ``max_bytes``. Returns the
    (possibly truncated) html and whether truncation happened. Pure function →
    unit-tested without a browser. Guards memory before extraction runs."""
    raw = html.encode("utf-8", "ignore")
    if len(raw) <= max_bytes:
        return html, False
    return raw[:max_bytes].decode("utf-8", "ignore"), True


def _clean_soup(html: str) -> BeautifulSoup:
    soup = BeautifulSoup(html, "lxml")
    for tag in soup.find_all(_STRIP_TAGS):
        tag.decompose()
    # Drop inline event handlers / style attrs so nothing executable survives even
    # as an attribute (defense in depth; markdownify would drop them anyway).
    for el in soup.find_all(True):
        for attr in list(el.attrs):
            if attr.lower().startswith("on") or attr.lower() == "style":
                del el.attrs[attr]
    return soup


def _page_title(soup: BeautifulSoup) -> str:
    if soup.title and soup.title.string:
        return soup.title.string.strip()
    h1 = soup.find("h1")
    if h1:
        return h1.get_text(strip=True)
    return ""


def _tidy_markdown(md: str) -> str:
    md = md.replace("\r\n", "\n").replace("\r", "\n")
    md = re.sub(r"[ \t]+\n", "\n", md)          # trailing whitespace
    md = re.sub(r"\n{3,}", "\n\n", md)          # collapse blank runs
    return md.strip()


def _to_markdown(html: str) -> str:
    return _tidy_markdown(_md(html, heading_style="ATX", strip=["script", "style"]))


def extract(html: str, mode: str) -> tuple[str, str]:
    """Return ``(title, markdown)`` for ``html`` under the given (already
    normalized) mode. Never raises on messy input — falls back to raw conversion
    if the readability pass fails or yields nothing."""
    soup = _clean_soup(html)
    title = _page_title(soup)

    if mode == "readable":
        try:
            doc = Document(html)
            short = (doc.short_title() or "").strip()
            if short:
                title = short
            summary_html = doc.summary(html_partial=True)
            markdown = _to_markdown(summary_html)
            if markdown:
                return title, markdown
        except Exception:
            pass  # fall through to raw conversion — degrade, never die

    body = soup.body or soup
    return title, _to_markdown(str(body))
