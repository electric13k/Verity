"""Confidence scoring (0-100) + RRR protocol (Rate, Reflect, Revise).

Heuristic scorer for now; the RRR hook is where a second model pass rates
and revises low-confidence answers once flows land on this pipeline.
"""

import re
from dataclasses import dataclass

HEDGES = re.compile(
    r"\b(i think|i believe|probably|might|maybe|not sure|unclear|i cannot|"
    r"i can't verify|as far as i know|it seems)\b",
    re.I,
)


@dataclass(frozen=True)
class Confidence:
    score: int  # 0-100
    rationale: str


def score_response(response: str) -> Confidence:
    if not response.strip():
        return Confidence(score=0, rationale="empty response")
    score = 75
    hedge_count = len(HEDGES.findall(response))
    score -= min(30, hedge_count * 8)
    if len(response.split()) < 5:
        score -= 15
    if re.search(r"\b(step|first|second|because|therefore)\b", response, re.I):
        score += 5
    if response.count("```") >= 2:
        score += 5  # complete code blocks
    score = max(0, min(100, score))
    parts = []
    if hedge_count:
        parts.append(f"{hedge_count} hedge(s)")
    parts.append("heuristic scorer; RRR revise pass lands with flows")
    return Confidence(score=score, rationale="; ".join(parts))
