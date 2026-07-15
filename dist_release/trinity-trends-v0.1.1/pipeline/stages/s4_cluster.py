"""
Stage 4 — Cluster into subtopics via HDBSCAN.

Groups the deduplicated items into coherent subtopic clusters using
density-based clustering. Unlike k-means, HDBSCAN doesn't require
knowing the number of clusters in advance and handles noise/outliers
natively (label = -1).
"""

from __future__ import annotations

import logging

import numpy as np
import hdbscan

from pipeline.models import ScoredItem, ClusteredItem
from pipeline import config

logger = logging.getLogger(__name__)


def cluster(
    items: list[ScoredItem],
    embeddings: np.ndarray,
) -> tuple[list[ClusteredItem], dict[int, list[ClusteredItem]], list[ClusteredItem]]:
    """
    Stage 4 entry point.

    Runs HDBSCAN on the item embeddings and assigns cluster labels.

    Args:
        items: Deduplicated scored items from Stage 3
        embeddings: Corresponding embedding vectors

    Returns:
        Tuple of:
          - All items with cluster labels (ClusteredItem)
          - Dict mapping cluster_id → list of items in that cluster
            (excludes noise cluster -1)
    """
    if not items or len(items) < config.HDBSCAN_MIN_CLUSTER_SIZE:
        # Too few items to cluster — treat all as one cluster
        clustered = [
            ClusteredItem(**item.model_dump(), cluster_id=0)
            for item in items
        ]
        return clustered, {0: clustered}

    # 1. L2 Normalization: Ensure all vectors have a length of 1.0
    # This makes Euclidean distance behave like Cosine Similarity.
    norms = np.linalg.norm(embeddings, axis=1, keepdims=True)
    normed_embeddings = embeddings / np.where(norms == 0, 1, norms)

    # 2. HDBSCAN with Epsilon Hack
    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=config.HDBSCAN_MIN_CLUSTER_SIZE,
        min_samples=config.HDBSCAN_MIN_SAMPLES,
        metric=config.HDBSCAN_METRIC,  
        cluster_selection_method="eom",
        # 0.15 is the "gravity" setting to pull noise into nearby clusters.
        # If clusters look too merged, reduce to 0.10.
        cluster_selection_epsilon=0.15, 
    )

    labels = clusterer.fit_predict(normed_embeddings)

    # Convert to ClusteredItems
    all_items: list[ClusteredItem] = []
    clusters: dict[int, list[ClusteredItem]] = {}

    for item, label in zip(items, labels):
        ci = ClusteredItem(**item.model_dump(), cluster_id=int(label))
        all_items.append(ci)
        clusters.setdefault(int(label), []).append(ci)

    noise_count = sum(1 for l in labels if l == -1)
    logger.info(
        f"Stage 4: {len(clusters)} clusters found, "
        f"{noise_count} noise items (of {len(items)} total)"
    )

    # Log cluster sizes
    for cid, members in sorted(clusters.items()):
        logger.debug(f"  Cluster {cid}: {len(members)} items")

    noise_items = clusters.pop(-1, [])
    return all_items, clusters, noise_items
