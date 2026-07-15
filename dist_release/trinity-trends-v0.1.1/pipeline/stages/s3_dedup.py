"""
Stage 3 — Deduplicate and diversify.

Semantic Deduplication + Maximal Marginal Relevance (MMR)
"""

from __future__ import annotations

import logging
from typing import Sequence

import numpy as np

from pipeline.models import ScoredItem
from pipeline import config

logger = logging.getLogger(__name__)

def _mmr_select(
    items: list[ScoredItem],
    embeddings: np.ndarray,
    k: int,
    lambda_: float,
) -> list[ScoredItem]:
    """
    Maximal Marginal Relevance selection.
    """
    if len(items) <= k:
        return items

    # 1. Relevance vector
    relevance = np.array([max(item.rerank_score, item.relevance_score) for item in items])
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
    similarity_threshold: float = 0.95
) -> tuple[list[ScoredItem], np.ndarray]:
    """
    Stage 3 entry point.

    1. Semantic dedup to remove near-duplicates (groups duplicates under representative)
    2. MMR selection to ensure diversity
    """
    if not items:
        return [], np.array([])

    # 1. Semantic Deduplication
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    normed_emb = embeddings / np.where(norms == 0, 1, norms)
    sim_matrix = normed_emb @ normed_emb.T

    # representative_id -> list of child ids
    dedup_map: dict[str, list[str]] = {item.id: [] for item in items}
    to_remove = set()
    
    # Process items in order of engagement to ensure highest engagement stays
    order = sorted(range(len(items)), key=lambda x: items[x].engagement, reverse=True)

    for idx_i in range(len(order)):
        i = order[idx_i]
        if i in to_remove:
            continue
            
        for idx_j in range(idx_i + 1, len(order)):
            j = order[idx_j]
            if j in to_remove:
                continue
                
            if sim_matrix[i, j] > similarity_threshold:
                # Add child ID to parent's evidence list
                dedup_map[items[i].id].append(items[j].id)
                dedup_map[items[i].id].extend(dedup_map[items[j].id]) # inherit any children
                to_remove.add(j)

    # 2. Rebuild list with updated metadata
    deduped_items = []
    final_indices = []
    for i, item in enumerate(items):
        if i not in to_remove:
            item.evidence_ids = dedup_map[item.id]
            deduped_items.append(item)
            final_indices.append(i)
            
    deduped_embeddings = embeddings[final_indices]

    # 3. MMR Diversification
    selected = _mmr_select(
        deduped_items,
        deduped_embeddings,
        k=config.MMR_TOP_K,
        lambda_=config.MMR_LAMBDA,
    )

    # Filter embeddings for selected items
    selected_ids = {item.id for item in selected}
    final_sel_indices = [i for i, item in enumerate(deduped_items) if item.id in selected_ids]
    final_sel_embeddings = deduped_embeddings[final_sel_indices]

    logger.info(
        f"Stage 3: {len(selected)} items after dedup+MMR "
        f"(Semantic Dedup: {len(items)}→{len(deduped_items)}, MMR: →{len(selected)})"
    )
    return selected, final_sel_embeddings
