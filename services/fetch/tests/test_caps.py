"""Resource caps: timeout clamp, byte clamp, and DOM size truncation. Pure —
no browser, no network."""

from __future__ import annotations

from app.config import Settings, clamp_max_bytes, clamp_timeout_ms
from app.extract import apply_size_cap

S = Settings(default_timeout_ms=30_000, max_timeout_ms=60_000, max_bytes=2_000_000)


# --- timeout clamp -----------------------------------------------------------
def test_timeout_default_when_none():
    assert clamp_timeout_ms(None, S) == 30_000


def test_timeout_ceiling():
    assert clamp_timeout_ms(999_999, S) == 60_000       # cannot exceed max


def test_timeout_floor():
    assert clamp_timeout_ms(1, S) == 1_000              # cannot go below 1s


def test_timeout_passthrough_in_range():
    assert clamp_timeout_ms(15_000, S) == 15_000


def test_timeout_bad_value_defaults():
    assert clamp_timeout_ms("not-an-int", S) == 30_000  # type: ignore[arg-type]


# --- byte clamp --------------------------------------------------------------
def test_max_bytes_default_when_none():
    assert clamp_max_bytes(None, S) == 2_000_000


def test_max_bytes_ceiling():
    assert clamp_max_bytes(9_000_000, S) == 2_000_000   # caller cannot raise cap


def test_max_bytes_floor():
    assert clamp_max_bytes(1, S) == 1_024


def test_max_bytes_shrink_allowed():
    assert clamp_max_bytes(50_000, S) == 50_000         # caller may lower it


# --- DOM size truncation -----------------------------------------------------
def test_size_cap_under_limit_untouched():
    html = "<p>hello</p>"
    out, truncated = apply_size_cap(html, 2_000_000)
    assert out == html and truncated is False


def test_size_cap_truncates_and_flags():
    html = "<p>" + ("A" * 10_000) + "</p>"
    out, truncated = apply_size_cap(html, 1_024)
    assert truncated is True
    assert len(out.encode("utf-8")) <= 1_024


def test_size_cap_never_splits_utf8_badly():
    # A cap landing mid multi-byte char must not raise; errors='ignore' drops it.
    html = "é" * 1_000  # 2 bytes each
    out, truncated = apply_size_cap(html, 101)  # odd cap → lands mid-char
    assert truncated is True
    out.encode("utf-8")  # round-trips cleanly, no exception
