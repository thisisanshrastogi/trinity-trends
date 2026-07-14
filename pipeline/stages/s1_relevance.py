"""
Stage 1 — Relevance filtering via bi-encoder embedding similarity.

Embeds all documents and expanded queries using the same model, then keeps
only documents whose max cosine similarity to any query exceeds the threshold.

This is the cheap, high-recall filter that cuts thousands of items down to
hundreds of plausibly relevant ones.
"""

from __future__ import annotations

import logging
from typing import Sequence

import numpy as np
from sentence_transformers import SentenceTransformer, util

from pipeline.models import NormalizedItem, ScoredItem
from pipeline import config

logger = logging.getLogger(__name__)

# Lazy-loaded model cache
_model: SentenceTransformer | None = None


def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        logger.info(f"Loading bi-encoder model: {config.BI_ENCODER_MODEL}")
        _model = SentenceTransformer(config.BI_ENCODER_MODEL, local_files_only=True)
    return _model


def relevance_filter(
    items: list[NormalizedItem],
    queries: list[str],
) -> list[ScoredItem]:
    """
    Stage 1 entry point.

    Embed all items and queries, compute cosine similarities, and keep
    items above the relevance threshold.

    Args:
        items: Normalized items from Stage 0
        queries: List of expanded query strings

    Returns:
        List of ScoredItems with relevance_score set
    """
    if not items:
        return []

    model = _get_model()

    # Encode
    logger.info(f"Encoding {len(queries)} queries and {len(items)} documents...")
    query_embeddings = model.encode(queries, show_progress_bar=False, convert_to_numpy=True)
    doc_texts = [item.text for item in items]
    doc_embeddings = model.encode(doc_texts, show_progress_bar=True, convert_to_numpy=True, batch_size=64)

    # Compute max similarity of each doc against all queries
    # Shape: (num_docs, num_queries)
    sim_matrix = util.cos_sim(doc_embeddings, query_embeddings).numpy()
    max_sims = sim_matrix.max(axis=1)  # (num_docs,)

    # Filter and convert
    survivors: list[ScoredItem] = []
    for i, item in enumerate(items):
        sim = float(max_sims[i])
        if sim >= config.RELEVANCE_THRESHOLD:
            scored = ScoredItem(
                **item.model_dump(),
                relevance_score=sim,
            )
            survivors.append(scored)

    logger.info(
        f"Stage 1: {len(survivors)}/{len(items)} items passed "
        f"(threshold={config.RELEVANCE_THRESHOLD})"
    )
    return survivors


def get_embeddings(items: list[ScoredItem]) -> np.ndarray:
    """
    Re-encode items for downstream stages (rerank, dedup, cluster).
    Returns numpy array of shape (len(items), embedding_dim).
    """
    model = _get_model()
    texts = [item.text for item in items]
    return model.encode(texts, show_progress_bar=False, convert_to_numpy=True, batch_size=64)
