#!/usr/bin/env python3
"""Schema validation for the verity-9b corpus.

A well-formed training line is a JSON object shaped:

    {"messages": [ {"role": "...", "content": "..."}, ... ]}

Rules enforced:
  - top level is an object with a "messages" list (non-empty);
  - each message has a string "role" in {system, user, assistant} and a
    non-empty string "content";
  - at most one system message, and only as the first message;
  - at least one user and one assistant message;
  - the final message is from the assistant (SFT target).

Reusable by build_dataset.py; also runnable standalone against any .jsonl:

    python validate.py path/to/file.jsonl [more.jsonl ...]

Pure standard library.
"""

import json
import sys
from pathlib import Path

VALID_ROLES = {"system", "user", "assistant"}


def validate_record(rec: object) -> list[str]:
    """Return a list of human-readable errors for one parsed record. Empty
    list means the record is valid."""
    errors: list[str] = []
    if not isinstance(rec, dict):
        return ["record is not a JSON object"]
    messages = rec.get("messages")
    if not isinstance(messages, list) or not messages:
        return ["'messages' must be a non-empty list"]

    roles: list[str] = []
    for i, msg in enumerate(messages):
        if not isinstance(msg, dict):
            errors.append(f"message[{i}] is not an object")
            continue
        role = msg.get("role")
        content = msg.get("content")
        if role not in VALID_ROLES:
            errors.append(f"message[{i}] has invalid role {role!r}")
        if not isinstance(content, str) or not content.strip():
            errors.append(f"message[{i}] has empty or non-string content")
        roles.append(role if isinstance(role, str) else "?")

    if roles.count("system") > 1:
        errors.append("more than one system message")
    if "system" in roles and roles[0] != "system":
        errors.append("system message must be first")
    if "user" not in roles:
        errors.append("no user message")
    if "assistant" not in roles:
        errors.append("no assistant message")
    if roles and roles[-1] != "assistant":
        errors.append("final message must be from the assistant")
    return errors


def validate_file(path: Path) -> tuple[int, list[str]]:
    """Validate one .jsonl file. Returns (records_seen, errors)."""
    seen = 0
    errors: list[str] = []
    with path.open(encoding="utf-8") as f:
        for lineno, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            seen += 1
            try:
                rec = json.loads(line)
            except json.JSONDecodeError as exc:
                errors.append(f"{path.name}:{lineno}: invalid JSON ({exc})")
                continue
            for err in validate_record(rec):
                errors.append(f"{path.name}:{lineno}: {err}")
    return seen, errors


def main(argv: list[str]) -> int:
    if not argv:
        print("usage: validate.py FILE.jsonl [FILE.jsonl ...]", file=sys.stderr)
        return 2
    total_seen = 0
    total_errors: list[str] = []
    for arg in argv:
        seen, errors = validate_file(Path(arg))
        total_seen += seen
        total_errors.extend(errors)
    if total_errors:
        for err in total_errors:
            print(f"ERROR {err}")
        print(f"\n{len(total_errors)} error(s) across {total_seen} record(s)")
        return 1
    print(f"OK: {total_seen} record(s) valid")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
