"""Prompt refiner v2 (port): complexity rater → structured template, with
tone profiles. Used as the "prompt optimizer" feature and internally before
provider calls when a prompt rates complex enough to benefit."""

import re
from dataclasses import dataclass

TONE_PROFILES = {
    "neutral": "Clear, direct, and precise.",
    "warm": "Friendly and encouraging without losing precision.",
    "formal": "Professional register; complete sentences; no colloquialisms.",
    "terse": "Minimal words. Answers only. No preamble.",
}


@dataclass(frozen=True)
class Refinement:
    complexity: int  # 0-100
    refined: str
    applied: bool


def rate_complexity(prompt: str) -> int:
    """0-100 heuristic: length, multi-part structure, code, constraints."""
    score = 0
    words = len(prompt.split())
    score += min(40, words // 5)
    if re.search(r"```|\bcode\b|\bfunction\b|\bapi\b", prompt, re.I):
        score += 15
    if re.search(r"\b(and|then|also|plus|after that)\b", prompt, re.I):
        score += 10
    if re.search(r"\b(must|should|require|constraint|format|exactly)\b", prompt, re.I):
        score += 15
    if prompt.count("?") > 1:
        score += 10
    if re.search(r"^\s*[-*\d]+[.)]?\s", prompt, re.M):
        score += 10
    return min(100, score)


def refine(prompt: str, tone: str = "neutral", threshold: int = 45) -> Refinement:
    """Rewrites complex prompts into the structured template; simple prompts
    pass through untouched (over-structuring a one-liner hurts)."""
    complexity = rate_complexity(prompt)
    if complexity < threshold:
        return Refinement(complexity=complexity, refined=prompt, applied=False)
    tone_line = TONE_PROFILES.get(tone, TONE_PROFILES["neutral"])
    refined = (
        "## Task\n"
        f"{prompt.strip()}\n\n"
        "## How to respond\n"
        f"- Tone: {tone_line}\n"
        "- Address every part of the task; if parts conflict, say so explicitly.\n"
        "- State assumptions you had to make.\n"
        "- If you are uncertain, say what would resolve the uncertainty."
    )
    return Refinement(complexity=complexity, refined=refined, applied=True)
