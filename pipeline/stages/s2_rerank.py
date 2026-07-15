"""
Stage 2 — Cross-encoder reranking.

Currently bypassed in the pipeline.
"""

from __future__ import annotations

import logging

from pipeline.models import ScoredItem

logger = logging.getLogger(__name__)

def rerank(
    items: list[ScoredItem],
    seed_query: str,
) -> list[ScoredItem]:
    """
    Stage 2 entry point (Bypassed).
    """
    if not items:
        return []

    logger.info("Stage 2: Rerank bypassed.")
    return items
