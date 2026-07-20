#!/usr/bin/env python3
"""Assemble the verity-9b SFT dataset from the committed corpus sources.

What it does:
  1. Reads every .jsonl under model/corpus/behavioral and
     model/corpus/structured_tasks (the committed sources).
  2. Renders the core Verity system prompt
     (model/corpus/system_prompts/verity_9b_core.md) into a system turn for any
     row that does not already carry one. Rows that ship their own (role-scoped
     conductor/worker/inspector/office/flow) system message keep it.
  3. Validates every row against the messages schema (see validate.py).
  4. Removes exact duplicates (same user+assistant content).
  5. Writes model/dataset/verity_sft.jsonl and prints a manifest: per-category
     counts, system-injection tally, dedupe result, schema result, and the
     output line count.

Pure standard library. Run with the brain venv or system python3:

    services/brain/.venv/bin/python model/scripts/build_dataset.py
    python3 model/scripts/build_dataset.py --no-system   # skip prompt injection
"""

import argparse
import json
import sys
from pathlib import Path

# Make validate.py importable regardless of the caller's cwd.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from validate import validate_record  # noqa: E402

MODEL_ROOT = Path(__file__).resolve().parent.parent
CORPUS = MODEL_ROOT / "corpus"
CORE_PROMPT_PATH = CORPUS / "system_prompts" / "verity_9b_core.md"
OUTPUT = MODEL_ROOT / "dataset" / "verity_sft.jsonl"

CATEGORIES = {
    "behavioral": CORPUS / "behavioral",
    "structured_tasks": CORPUS / "structured_tasks",
}


def load_core_prompt() -> str:
    return CORE_PROMPT_PATH.read_text(encoding="utf-8").strip()


def dedupe_key(messages: list[dict]) -> tuple:
    """Identity of an example for dedupe: its non-system turns. Two rows with
    the same user+assistant content are duplicates even if one had a system
    prompt injected and the other did not."""
    return tuple(
        (m["role"], m["content"].strip())
        for m in messages
        if m["role"] != "system"
    )


def iter_source_files() -> list[tuple[str, Path]]:
    files: list[tuple[str, Path]] = []
    for category, directory in CATEGORIES.items():
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob("*.jsonl")):
            files.append((category, path))
    return files


def build(inject_system: bool) -> int:
    core_prompt = load_core_prompt() if inject_system else ""

    per_file: dict[str, int] = {}
    per_category: dict[str, int] = {c: 0 for c in CATEGORIES}
    schema_errors: list[str] = []
    injected = 0
    already_had_system = 0

    seen_keys: dict[tuple, str] = {}
    duplicates: list[str] = []
    assembled: list[dict] = []

    for category, path in iter_source_files():
        rel = path.relative_to(MODEL_ROOT)
        count = 0
        with path.open(encoding="utf-8") as f:
            for lineno, line in enumerate(f, start=1):
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except json.JSONDecodeError as exc:
                    schema_errors.append(f"{rel}:{lineno}: invalid JSON ({exc})")
                    continue

                errors = validate_record(rec)
                if errors:
                    for err in errors:
                        schema_errors.append(f"{rel}:{lineno}: {err}")
                    continue

                messages = rec["messages"]
                has_system = messages[0]["role"] == "system"
                if has_system:
                    already_had_system += 1
                elif inject_system:
                    messages = [{"role": "system", "content": core_prompt}, *messages]
                    injected += 1

                key = dedupe_key(messages)
                if key in seen_keys:
                    duplicates.append(f"{rel}:{lineno} duplicates {seen_keys[key]}")
                    continue
                seen_keys[key] = f"{rel}:{lineno}"

                assembled.append({"messages": messages})
                count += 1
                per_category[category] += 1

        per_file[str(rel)] = count

    # ---- write output -----------------------------------------------------
    if schema_errors:
        print("SCHEMA VALIDATION FAILED — dataset not written.\n")
        for err in schema_errors:
            print(f"  ERROR {err}")
        print(f"\n{len(schema_errors)} schema error(s).")
        return 1

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    with OUTPUT.open("w", encoding="utf-8") as f:
        for rec in assembled:
            f.write(json.dumps(rec, ensure_ascii=False) + "\n")

    # ---- manifest ---------------------------------------------------------
    print("=" * 66)
    print("verity-9b SFT dataset — build manifest")
    print("=" * 66)
    print(f"core system prompt : {CORE_PROMPT_PATH.relative_to(MODEL_ROOT)}"
          f"  ({'injected' if inject_system else 'DISABLED (--no-system)'})")
    print()
    print("Per-source counts:")
    for category in CATEGORIES:
        print(f"  [{category}]")
        for rel, count in sorted(per_file.items()):
            if rel.startswith(f"corpus/{category}/"):
                print(f"    {count:>3}  {rel}")
        print(f"    {'-' * 3}")
        print(f"    {per_category[category]:>3}  category total")
    print()
    print("System-turn rendering:")
    print(f"  {already_had_system:>3}  rows carried their own (role-scoped) system prompt")
    print(f"  {injected:>3}  rows received the core Verity system prompt")
    print()
    print("Dedupe check:")
    if duplicates:
        print(f"  {len(duplicates)} duplicate row(s) removed:")
        for d in duplicates:
            print(f"    - {d}")
    else:
        print("  0 duplicates — all rows unique")
    print()
    print("Schema validation:")
    print(f"  {len(assembled)} row(s) valid, 0 errors")
    print()
    total_examples = per_category["behavioral"] + per_category["structured_tasks"]
    print(f"TOTAL written : {len(assembled)} example(s)  (sanity: {total_examples})")
    print(f"Output        : {OUTPUT.relative_to(MODEL_ROOT)}")
    size_kb = OUTPUT.stat().st_size / 1024
    print(f"Size          : {size_kb:.1f} KiB")
    print("=" * 66)
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Build the verity-9b SFT dataset.")
    parser.add_argument(
        "--no-system",
        action="store_true",
        help="do not render the core system prompt into rows that lack one",
    )
    args = parser.parse_args()
    return build(inject_system=not args.no_system)


if __name__ == "__main__":
    raise SystemExit(main())
