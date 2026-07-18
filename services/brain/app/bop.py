"""Blind Orchestration Protocol (BOP) — machinery never crosses a
boundary; task substance always does.

Any text leaving an internal role (worker output entering the transcript,
skill/plugin output entering a prompt, flow events leaving the brain) is
sanitized: references to orchestration machinery are redacted, task content
is left intact.
"""

import re

REDACTED = "[machinery-redacted]"

# Machinery markers that must never leak across boundaries. Kept
# deliberately narrow: BOP redacts machinery, never task substance.
_MACHINERY = re.compile(
    r"(system prompt|you are (?:the )?(?:conductor|worker|inspector)\b|"
    r"<\s*/?\s*(?:conductor|worker|inspector|orchestrat\w*)\s*>|"
    r"\bBOP\b|blind orchestration)",
    re.I,
)


def sanitize_machinery(text: str) -> str:
    return _MACHINERY.sub(REDACTED, text)
