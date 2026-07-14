"""
Stage 3 — Deduplicate and diversify.

Two methods combined:
  1. MinHash LSH: near-exact deduplication (catches copy-pasted / slightly reworded posts)
  2. Maximal Marginal Relevance (MMR): picks items that are both relevant AND
     diverse from already-selected items.
"""

from __future__ import annotations

import logging
from typing import Sequence

import numpy as np
from datasketch import MinHash, MinHashLSH

from pipeline.models import ScoredItem
from pipeline import config

logger = logging.getLogger(__name__)


def _minhash_text(text: str, num_perm: int = 128) -> MinHash:
    """Create a MinHash from text shingles (3-word windows)."""
    m = MinHash(num_perm=num_perm)
    words = text.lower().split()
    for i in range(len(words) - 2):
        shingle = " ".join(words[i : i + 3])
        m.update(shingle.encode("utf-8"))
    return m


def _minhash_dedup(items: list[ScoredItem]) -> list[ScoredItem]:
    """Remove near-duplicate items using MinHash LSH."""
    lsh = MinHashLSH(threshold=config.MINHASH_THRESHOLD, num_perm=128)
    unique: list[ScoredItem] = []

    for item in items:
        mh = _minhash_text(item.text)
        # Check if this item is similar to any already-inserted item
        if not lsh.query(mh):
            try:
                lsh.insert(item.id, mh)
                unique.append(item)
            except ValueError:
                # Duplicate key (shouldn't happen with unique IDs, but just in case)
                pass

    logger.info(f"MinHash dedup: {len(unique)}/{len(items)} items survived")
    return unique


def _mmr_select(
    items: list[ScoredItem],
    embeddings: np.ndarray,
    k: int,
    lambda_: float,
) -> list[ScoredItem]:
    """
    Maximal Marginal Relevance selection.

    Iteratively picks items that maximize:
      mmr_score = λ * relevance[i] - (1-λ) * max_sim_to_selected[i]

    This ensures the final set is both relevant AND diverse.
    """
    if len(items) <= k:
        return items

    # Normalize relevance scores
    relevance = np.array([item.rerank_score for item in items])
    if relevance.max() > relevance.min():
        relevance = (relevance - relevance.min()) / (relevance.max() - relevance.min())

    # Precompute cosine similarity matrix
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    norms = np.where(norms == 0, 1, norms)
    normed = embeddings / norms
    sim_matrix = normed @ normed.T

    n = len(items)
    selected_indices: list[int] = []
    remaining = set(range(n))

    for _ in range(k):
        best_idx = -1
        best_score = -float("inf")

        for idx in remaining:
            rel = lambda_ * relevance[idx]
            if selected_indices:
                max_sim = max(sim_matrix[idx, s] for s in selected_indices)
            else:
                max_sim = 0.0
            diversity_penalty = (1 - lambda_) * max_sim
            mmr = rel - diversity_penalty

            if mmr > best_score:
                best_score = mmr
                best_idx = idx

        if best_idx == -1:
            break

        selected_indices.append(best_idx)
        remaining.discard(best_idx)

    return [items[i] for i in selected_indices]


def dedup_and_diversify(
    items: list[ScoredItem],
    embeddings: np.ndarray,
) -> tuple[list[ScoredItem], np.ndarray]:
    """
    Stage 3 entry point.

    1. MinHash dedup to remove near-duplicates
    2. MMR selection to ensure diversity

    Args:
        items: Scored items from Stage 2
        embeddings: Corresponding embedding vectors

    Returns:
        Tuple of (selected items, corresponding embeddings)
    """
    if not items:
        return [], np.array([])

    # Step 1: MinHash dedup
    # We need to track which items survived to filter embeddings
    original_ids = {item.id: i for i, item in enumerate(items)}
    deduped = _minhash_dedup(items)
    deduped_indices = [original_ids[item.id] for item in deduped]
    deduped_embeddings = embeddings[deduped_indices]

    # Step 2: MMR selection
    selected = _mmr_select(
        deduped,
        deduped_embeddings,
        k=config.MMR_TOP_K,
        lambda_=config.MMR_LAMBDA,
    )

    # Filter embeddings for selected items
    selected_ids = {item.id for item in selected}
    final_indices = [i for i, item in enumerate(deduped) if item.id in selected_ids]
    final_embeddings = deduped_embeddings[final_indices]

    logger.info(
        f"Stage 3: {len(selected)} items after dedup+MMR "
        f"(MinHash: {len(items)}→{len(deduped)}, MMR: →{len(selected)})"
    )
    return selected, final_embeddings
