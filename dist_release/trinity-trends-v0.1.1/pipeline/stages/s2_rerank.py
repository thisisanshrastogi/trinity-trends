"""
Stage 2 — Cross-encoder reranking.

Takes the ~500-1000 survivors from Stage 1 and assigns a precise relevance
score using a cross-encoder model (processes query+doc together).

Much more accurate than bi-encoder, but too slow for the full dataset —
hence Stage 1 exists first as a cheap pre-filter.
"""

from __future__ import annotations

import logging
from typing import Sequence

import numpy as np
from sentence_transformers import CrossEncoder

from pipeline.models import ScoredItem
from pipeline import config

logger = logging.getLogger(__name__)

_reranker: CrossEncoder | None = None


def _get_reranker() -> CrossEncoder:
    global _reranker
    if _reranker is None:
        logger.info(f"Loading cross-encoder model: {config.CROSS_ENCODER_MODEL}")
        _reranker = CrossEncoder(config.CROSS_ENCODER_MODEL, local_files_only=True)
    return _reranker


def rerank(
    items: list[ScoredItem],
    seed_query: str,
) -> list[ScoredItem]:
    """
    Stage 2 entry point.

    Reranks items using a cross-encoder against the seed query, then
    keeps the top N items.

    Args:
        items: Scored items from Stage 1
        seed_query: The original seed query (e.g. "AI coding tools")

    Returns:
        Top-N items sorted by cross-encoder rerank score
    """
    if not items:
        return []

    reranker = _get_reranker()

    # Build (query, document) pairs
    pairs = [(seed_query, item.text) for item in items]

    logger.info(f"Reranking {len(pairs)} items with cross-encoder...")
    raw_scores = reranker.predict(pairs, show_progress_bar=True, batch_size=32)

    # Normalize scores to [0, 1] range
    scores = np.array(raw_scores, dtype=np.float64)
    if scores.max() > scores.min():
        scores = (scores - scores.min()) / (scores.max() - scores.min())
    else:
        scores = np.ones_like(scores)

    # Assign scores and sort
    for item, score in zip(items, scores):
        item.rerank_score = float(score)

    ranked = sorted(items, key=lambda x: x.rerank_score, reverse=True)
    top_n = ranked[: config.RERANK_TOP_N]

    logger.info(
        f"Stage 2: kept top {len(top_n)}/{len(items)} items "
        f"(score range: {top_n[-1].rerank_score:.3f} – {top_n[0].rerank_score:.3f})"
    )
    return top_n
