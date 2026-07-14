"""
Stage 7 — Score signals.

Pure arithmetic scoring — no LLM. Computes a weighted composite score
from multiple components:
  - relevance (from stage 2 rerank, averaged over evidence)
  - evidence_count (frequency, log-scaled)
  - velocity (placeholder — requires time-series data)
  - source_spread (cross-platform agreement)
  - engagement (normalized average)
  - novelty (placeholder — 1 - similarity to previously-seen signals)
"""

from __future__ import annotations

import math
import logging

import numpy as np

from pipeline.models import MergedSignal
from pipeline import config

logger = logging.getLogger(__name__)


def score_signals(
    signals: list[MergedSignal],
    total_sources: int = 3,  # reddit, youtube, hackerNews
) -> list[MergedSignal]:
    """
    Stage 7 entry point.

    Assigns a final_score to each signal based on weighted components.
    Returns signals sorted by final_score descending.

    Args:
        signals: Merged signals from Stage 6
        total_sources: Total number of possible source platforms

    Returns:
        Scored and sorted signals
    """
    if not signals:
        return []

    w = config.SCORE_WEIGHTS

    # Compute normalization factors across all signals
    max_evidence = max(s.evidence_count for s in signals) if signals else 1
    max_engagement = max(s.avg_engagement for s in signals) if signals else 1.0

    for signal in signals:
        # 1. Relevance: already in [0, 1] from reranking
        relevance = min(signal.avg_relevance, 1.0)

        # 2. Evidence count: log-scaled so it doesn't dominate
        evidence = math.log(signal.evidence_count + 1) / math.log(max_evidence + 1) if max_evidence > 0 else 0

        # 3. Velocity: placeholder (would need historical data)
        #    For now, use a flat 0.5 — this should be computed from
        #    time-series mention data when available
        velocity = 0.5

        # 4. Source spread: fraction of unique sources represented
        source_spread = len(signal.sources) / total_sources if total_sources > 0 else 0

        # 5. Engagement: normalized against max in this batch
        engagement = signal.avg_engagement / max_engagement if max_engagement > 0 else 0

        # 6. Novelty: placeholder (would need comparison to historical signals)
        #    For now, use inverse of evidence density — rarer signals are more novel
        novelty = 1.0 - (signal.evidence_count / (max_evidence + 1))

        # Store components for debugging / tuning
        signal.relevance_component = round(relevance, 4)
        signal.evidence_component = round(evidence, 4)
        signal.velocity_component = round(velocity, 4)
        signal.source_spread_component = round(source_spread, 4)
        signal.engagement_component = round(engagement, 4)
        signal.novelty_component = round(novelty, 4)

        # Weighted sum
        signal.final_score = round(
            w["relevance"] * relevance
            + w["evidence_count"] * evidence
            + w["velocity"] * velocity
            + w["source_spread"] * source_spread
            + w["engagement"] * engagement
            + w["novelty"] * novelty,
            4,
        )

    # Sort descending by final score
    signals.sort(key=lambda s: s.final_score, reverse=True)

    logger.info(
        f"Stage 7: scored {len(signals)} signals "
        f"(top={signals[0].final_score:.3f}, bottom={signals[-1].final_score:.3f})"
    )

    for s in signals[:5]:
        logger.debug(
            f"  {s.signal_id}: score={s.final_score:.3f} "
            f"[rel={s.relevance_component:.2f}, ev={s.evidence_component:.2f}, "
            f"src={s.source_spread_component:.2f}] — {s.summary[:60]}"
        )

    return signals
