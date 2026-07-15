"""
Pipeline runner — orchestrates all 9 stages in sequence.
"""

from __future__ import annotations

import json
import time
import logging
import pickle
from pathlib import Path

from pipeline.models import CollectionScored, AnalysisOutput, FinalSynthesisOutput
from pipeline import config
from pipeline.stages.s0_normalize import normalize
from pipeline.stages.s1_relevance import relevance_filter, get_embeddings
from pipeline.stages.s2_rerank import rerank
from pipeline.stages.s3_dedup import dedup_and_diversify
from pipeline.stages.s4_cluster import cluster
from pipeline.stages.s5_extract import extract_signals
from pipeline.stages.s6_merge import merge_signals
from pipeline.stages.s7_score import score_signals
from pipeline.stages.s8_compress import compress

logger = logging.getLogger(__name__)


def run_pipeline(
    input_path: Path | None = None,
    output_path: Path | None = None,
    min_score: float = 0.0,
    start_stage: int = 0,
    end_stage: int = 9,
    state_file: Path | None = None
) -> FinalSynthesisOutput | dict | None:
    """
    Execute the analysis pipeline.

    Args:
        input_path: Path to collection-scored.json (default: config.INPUT_FILE)
        output_path: Path to write analysis-result.json (default: config.RESULT_FILE)
        min_score: Minimum score for synthesis
        start_stage: Stage to start from (0-9)
        end_stage: Stage to end at (0-9)
        state_file: Path to load/save intermediate state via pickle

    Returns:
        The final SynthesisOutput if completed, else the state dictionary if paused early.
    """
    input_path = input_path or config.INPUT_FILE
    output_path = output_path or config.RESULT_FILE

    total_start = time.time()
    
    state = {}
    if start_stage > 0 and state_file and state_file.exists():
        logger.info(f"Loading state from {state_file}")
        with open(state_file, "rb") as f:
            state = pickle.load(f)
            
    if start_stage == 0:
        # ── Load input ───────────────────────────────────────────────────────
        logger.info(f"Loading input from {input_path}")
        with open(input_path) as f:
            raw = json.load(f)
        data = CollectionScored(**raw)
        seed_query = data.seed
        queries = [r.query for r in data.results]
        logger.info(f"Seed: {seed_query!r}, {len(data.results)} queries, {len(queries)} query variants")
        
        state['data'] = data
        state['seed_query'] = seed_query
        state['queries'] = queries

    # Stage 0: Normalize
    if start_stage <= 0 <= end_stage:
        t0 = time.time()
        normalized = normalize(state['data'])
        logger.info(f"  → Stage 0: {len(normalized)} items ({time.time() - t0:.1f}s)")

        if not normalized:
            logger.warning("No items survived normalization. Aborting.")
            return AnalysisOutput(topic=state['seed_query'], stats={"error": "No data after normalization"})

        state['normalized'] = normalized
        state['total_raw'] = len(normalized)

    # Stage 1: Relevance filter
    if start_stage <= 1 <= end_stage:
        t1 = time.time()
        scored, scored_embeddings, tu = relevance_filter(state['normalized'], state['queries'])
        logger.info(f"  → Stage 1: {len(scored)} items ({time.time() - t1:.1f}s)")

        if not scored:
            logger.warning("No items passed relevance filter.")
            return AnalysisOutput(topic=state['seed_query'], stats={"error": "No relevant items"})

        state['scored'] = scored
        state['scored_embeddings'] = scored_embeddings
        if 'token_usages' not in state: state['token_usages'] = []
        state['token_usages'].append(tu)

    # Stage 2: Rerank (BYPASSED)
    if start_stage <= 2 <= end_stage:
        t2 = time.time()
        # We bypass reranking because gemini-embedding-2 is strong enough
        reranked = state['scored']
        embeddings = state['scored_embeddings']
        logger.info(f"  → Stage 2: Rerank bypassed. {len(reranked)} items ({time.time() - t2:.1f}s)")

        state['reranked'] = reranked
        state['embeddings'] = embeddings

    # Stage 3: Dedup + Diversify
    if start_stage <= 3 <= end_stage:
        t3 = time.time()
        deduped, deduped_embeddings = dedup_and_diversify(state['reranked'], state['embeddings'])
        logger.info(f"  → Stage 3: {len(deduped)} items ({time.time() - t3:.1f}s)")
        state['deduped'] = deduped
        state['deduped_embeddings'] = deduped_embeddings

    # Stage 4: Cluster
    if start_stage <= 4 <= end_stage:
        t4 = time.time()
        all_clustered, clusters, noise_items = cluster(state['deduped'], state['deduped_embeddings'])
        logger.info(f"  → Stage 4: {len(clusters)} clusters ({time.time() - t4:.1f}s)")
        state['all_clustered'] = all_clustered
        state['clusters'] = clusters
        state['noise_items'] = noise_items

    # Stage 5: Extract signals
    if start_stage <= 5 <= end_stage:
        t5 = time.time()
        extracted, token_usages_s5 = extract_signals(state['clusters'], state.get('noise_items', []), state['seed_query'])
        logger.info(f"  → Stage 5: {len(extracted)} signals ({time.time() - t5:.1f}s)")
        state['extracted'] = extracted
        if 'token_usages' not in state:
            state['token_usages'] = []
        state['token_usages'].extend(token_usages_s5)

    # Stage 6: Merge signals
    if start_stage <= 6 <= end_stage:
        t6 = time.time()
        merged = merge_signals(state['extracted'])
        logger.info(f"  → Stage 6: {len(merged)} merged signals ({time.time() - t6:.1f}s)")
        state['merged'] = merged

    # Stage 7: Score
    if start_stage <= 7 <= end_stage:
        t7 = time.time()
        scored_signals = score_signals(state['merged'])
        logger.info(f"  → Stage 7: scored ({time.time() - t7:.1f}s)")
        state['scored_signals'] = scored_signals

    # Stage 8: Compress
    if start_stage <= 8 <= end_stage:
        t8 = time.time()
        output = compress(state['scored_signals'], state['seed_query'], total_evidence=state['total_raw'])
        logger.info(f"  → Stage 8: compressed ({time.time() - t8:.1f}s)")
        state['output'] = output

    # Stage 9: Synthesize
    if start_stage <= 9 <= end_stage:
        t9 = time.time()
        from pipeline.stages.s9_synthesize import synthesize_trends
        final_output = synthesize_trends(state['output'], min_score=min_score)
        if 'token_usages' in state:
            final_output.token_usage.extend(state['token_usages'])
        
        if 'normalized' in state:
            final_output.posts_by_id = {item.id: item for item in state['normalized']}

        logger.info(f"  → Stage 9: synthesized ({time.time() - t9:.1f}s)")
        state['final_output'] = final_output
        
        # Save output
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w") as f:
            json.dump(final_output.model_dump(), f, indent=2, default=str)
        logger.info(f"Output written to {output_path}")

        total_time = time.time() - total_start
        logger.info(f"Pipeline complete in {total_time:.1f}s")
        


        return final_output

    if end_stage < 9 and state_file:
        logger.info(f"Saving paused state to {state_file}")
        with open(state_file, "wb") as f:
            pickle.dump(state, f)
        print(f"\nPipeline paused at stage {end_stage}. State saved to {state_file}")
        return state

    return None
