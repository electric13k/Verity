"""Markdown extraction from local HTML — no browser, no network."""

from __future__ import annotations

from app.extract import apply_size_cap, extract, normalize_mode

SAMPLE = """
<!doctype html>
<html>
<head>
  <title>Widgets Quarterly — Q3 Report</title>
  <style>.ad{display:none}</style>
  <script>window.SECRET_TOKEN_MUST_NOT_APPEAR = 'abc123'; alert('x');</script>
</head>
<body>
  <nav><a href="/">Home</a> <a href="/about">About</a></nav>
  <article>
    <h1>Widget Shipments Reached A Record High</h1>
    <p>In the third quarter, widget shipments climbed to an unprecedented level
       across every region, driven by strong demand for the new matcha edition.</p>
    <h2>Regional breakdown</h2>
    <p>The northern territory led with a forty percent year-over-year increase,
       while the coastal markets posted steady, dependable gains.</p>
    <ul><li>North: up 40%</li><li>Coast: up 12%</li></ul>
    <p>Read the <a href="https://example.com/full">full report</a> for details.</p>
  </article>
  <footer>© Widgets Inc</footer>
</body>
</html>
"""


def test_normalize_mode_vocabularies():
    assert normalize_mode(None) == "readable"
    assert normalize_mode("markdown") == "readable"   # brain's default value
    assert normalize_mode("readable") == "readable"
    assert normalize_mode("text") == "raw"            # brain's alt value
    assert normalize_mode("raw") == "raw"
    assert normalize_mode("weird") == "readable"      # unknown → safe default


def test_readable_extracts_title_and_content():
    title, md = extract(SAMPLE, "readable")
    assert "Widgets Quarterly" in title or "Record High" in title
    assert "widget shipments climbed to an unprecedented level" in md
    assert "forty percent year-over-year" in md


def test_headings_and_links_become_markdown():
    _, md = extract(SAMPLE, "readable")
    assert "#" in md                                  # ATX heading present
    assert "Regional breakdown" in md
    assert "](https://example.com/full)" in md        # link preserved as markdown


def test_script_and_style_never_leak():
    for mode in ("readable", "raw"):
        title, md = extract(SAMPLE, mode)
        blob = title + "\n" + md
        assert "SECRET_TOKEN_MUST_NOT_APPEAR" not in blob
        assert "alert(" not in blob
        assert "display:none" not in blob


def test_raw_mode_returns_body_text():
    title, md = extract(SAMPLE, "raw")
    assert "Widget Shipments Reached A Record High" in md
    # raw keeps more of the page chrome (nav/footer) than readable does
    assert "widget shipments climbed" in md


def test_extract_survives_minimal_html():
    # A degenerate document must not raise — degrade to raw conversion.
    title, md = extract("<html><body><p>bare</p></body></html>", "readable")
    assert "bare" in md


def test_extract_survives_empty():
    title, md = extract("", "readable")
    assert isinstance(title, str) and isinstance(md, str)


def test_size_cap_before_extract_bounds_input():
    big = "<html><body>" + "<p>spam</p>" * 100_000 + "</body></html>"
    capped, truncated = apply_size_cap(big, 4_096)
    assert truncated is True
    # extraction still succeeds on the truncated fragment
    _, md = extract(capped, "raw")
    assert isinstance(md, str)
