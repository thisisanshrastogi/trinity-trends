"""
Stage 6 — Merge signals across clusters/sources.

The same signal (e.g. "AI coding tools are too expensive") might emerge
from multiple clusters or sources (Reddit + HN). This stage embeds the
extracted pain_point/feature_request short strings and merges signals
whose embeddings are above a cosine similarity threshold.
"""

from __future__ import annotations

import logging
import hashlib
from typing import Sequence

import numpy as np
from sentence_transformers import SentenceTransformer

from pipeline.models import ExtractedSignal, MergedSignal
from pipeline import config

logger = logging.getLogger(__name__)


def _signal_text(signal: ExtractedSignal) -> str:
    """Create a single text representation for embedding."""
    parts = []
    if signal.entity:
        parts.append(signal.entity)
    if signal.pain_point:
        parts.append(signal.pain_point)
    if signal.feature_request:
        parts.append(signal.feature_request)
    if signal.summary:
        parts.append(signal.summary)
    return " | ".join(parts) if parts else "unknown signal"


def _make_signal_id(text: str) -> str:
    """Generate a short hash ID for a signal."""
    return "sig_" + hashlib.sha256(text.encode()).hexdigest()[:12]


def merge_signals(
    signals: list[ExtractedSignal],
) -> list[MergedSignal]:
    """
    Stage 6 entry point.

    Embeds extracted signals' key fields and groups similar ones
    (cosine > threshold) into merged signals.

    Args:
        signals: Extracted signals from Stage 5

    Returns:
        List of MergedSignals with duplicate signals collapsed
    """
    if not signals:
        return []

    if len(signals) == 1:
        s = signals[0]
        return [MergedSignal(
            signal_id=_make_signal_id(_signal_text(s)),
            entities=[s.entity] if s.entity else [],
            pain_points=[s.pain_point] if s.pain_point else [],
            feature_requests=[s.feature_request] if s.feature_request else [],
            sentiment=s.sentiment,
            intents=[s.intent] if s.intent else [],
            summary=s.summary,
            evidence_count=s.evidence_count,
            sources=s.sources,
            representative_quotes=s.representative_quotes,
            avg_relevance=s.avg_relevance,
            avg_engagement=s.avg_engagement,
        )]

    # Embed signal texts
    model = SentenceTransformer(config.BI_ENCODER_MODEL)
    texts = [_signal_text(s) for s in signals]
    embeddings = model.encode(texts, convert_to_numpy=True)

    # Compute pairwise cosine similarity
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1, norms)
    normed = embeddings / norms
    sim_matrix = normed @ normed.T

    # Greedy merge: union-find style grouping
    n = len(signals)
    merged_into: list[int] = list(range(n))  # Each signal points to its group leader

    for i in range(n):
        for j in range(i + 1, n):
            if sim_matrix[i, j] >= config.MERGE_SIMILARITY_THRESHOLD:
                # Merge j into i's group
                leader_j = merged_into[j]
                leader_i = merged_into[i]
                # Point everything in j's group to i's leader
                for k in range(n):
                    if merged_into[k] == leader_j:
                        merged_into[k] = leader_i

    # Group signals by their leader
    groups: dict[int, list[ExtractedSignal]] = {}
    for idx, leader in enumerate(merged_into):
        groups.setdefault(leader, []).append(signals[idx])

    # Build merged signals
    merged: list[MergedSignal] = []
    for leader_idx, group in groups.items():
        entities = list(set(s.entity for s in group if s.entity))
        pain_points = list(set(s.pain_point for s in group if s.pain_point))
        feature_requests = list(set(s.feature_request for s in group if s.feature_request))
        intents = list(set(s.intent for s in group if s.intent))
        all_sources = list(set(src for s in group for src in s.sources))
        all_quotes = []
        for s in group:
            all_quotes.extend(s.representative_quotes)
        all_quotes = all_quotes[:5]  # Cap at 5 quotes

        # Use the most evidence-rich signal's summary as the primary
        primary = max(group, key=lambda s: s.evidence_count)
        total_evidence = sum(s.evidence_count for s in group)
        avg_rel = sum(s.avg_relevance for s in group) / len(group)
        avg_eng = sum(s.avg_engagement for s in group) / len(group)

        # Determine overall sentiment (majority vote)
        sentiments = [s.sentiment for s in group if s.sentiment]
        if sentiments:
            from collections import Counter
            sentiment = Counter(sentiments).most_common(1)[0][0]
        else:
            sentiment = "neutral"

        merged.append(MergedSignal(
            signal_id=_make_signal_id(_signal_text(primary)),
            entities=entities,
            pain_points=pain_points,
            feature_requests=feature_requests,
            sentiment=sentiment,
            intents=intents,
            summary=primary.summary,
            evidence_count=total_evidence,
            sources=all_sources,
            representative_quotes=all_quotes,
            avg_relevance=avg_rel,
            avg_engagement=avg_eng,
        ))

    logger.info(
        f"Stage 6: merged {len(signals)} signals → {len(merged)} "
        f"(threshold={config.MERGE_SIMILARITY_THRESHOLD})"
    )
    return merged
