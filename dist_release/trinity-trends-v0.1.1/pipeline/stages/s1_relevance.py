"""
Stage 1 — Relevance Filter (Batched Async Gemini Embeddings).

Embed all documents and queries, compute cosine similarities, and keep items above the threshold.
"""

from __future__ import annotations

import logging
import asyncio
from typing import Sequence
import concurrent.futures

import numpy as np
from google import genai
from google.genai import types
from tenacity import retry, wait_exponential, stop_after_attempt

from pipeline.models import NormalizedItem, ScoredItem, TokenUsage
from pipeline import config

logger = logging.getLogger(__name__)

# =============================================================================
# --- OLD SENTENCE-TRANSFORMERS CODE (COMMENTED OUT) ---
# =============================================================================
"""
from sentence_transformers import SentenceTransformer, util

# Lazy-loaded model cache
_model: SentenceTransformer | None = None

def _get_model() -> SentenceTransformer:
    global _model
    if _model is None:
        logger.info(f"Loading bi-encoder model: {config.BI_ENCODER_MODEL}")
        _model = SentenceTransformer(config.BI_ENCODER_MODEL, local_files_only=True)
    return _model

def _chunk_text(text: str, chunk_size: int = 180, overlap: int = 30) -> list[str]:
    words = text.split()
    if len(words) <= chunk_size:
        return [text] if text else []
    chunks = []
    i = 0
    while i < len(words):
        chunk = " ".join(words[i : i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
        if i + overlap >= len(words):
            break
    return chunks

def relevance_filter(
    items: list[NormalizedItem],
    queries: list[str],
) -> list[ScoredItem]:
    if not items or not queries:
        return []

    model = _get_model()

    logger.info(f"Encoding {len(queries)} query variants...")
    bge_prefix = "Represent this sentence for searching relevant passages: "
    formatted_queries = [f"{bge_prefix}{q}" for q in queries]
    query_embeddings = model.encode(formatted_queries, show_progress_bar=False, convert_to_numpy=True)

    flat_texts = []
    item_mapping = []

    logger.info("Chunking documents to bypass token limits...")
    for i, item in enumerate(items):
        if item.title:
            flat_texts.append(item.title)
            item_mapping.append(i)
        chunks = _chunk_text(item.text)
        for chunk in chunks:
            flat_texts.append(chunk)
            item_mapping.append(i)

    if not flat_texts:
        return []

    logger.info(f"Encoding {len(flat_texts)} individual text chunks from {len(items)} items...")
    chunk_embeddings = model.encode(flat_texts, show_progress_bar=True, convert_to_numpy=True, batch_size=64)

    sim_matrix = util.cos_sim(chunk_embeddings, query_embeddings).numpy()
    max_sims_per_chunk = sim_matrix.max(axis=1) 

    item_max_scores = {i: 0.0 for i in range(len(items))}
    for chunk_idx, item_idx in enumerate(item_mapping):
        score = float(max_sims_per_chunk[chunk_idx])
        if score > item_max_scores[item_idx]:
            item_max_scores[item_idx] = score

    survivors: list[ScoredItem] = []
    for i, item in enumerate(items):
        sim = item_max_scores[i]
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
    survivors.sort(key=lambda x: x.relevance_score, reverse=True)
    return survivors

def get_embeddings(items: list[ScoredItem]) -> np.ndarray:
    model = _get_model()
    texts = [item.text for item in items]
    return model.encode(texts, show_progress_bar=False, convert_to_numpy=True, batch_size=64)
"""

# =============================================================================
# --- NEW GEMINI EMBEDDING PIPELINE (ASYNC & BATCHED) ---
# =============================================================================

BATCH_SIZE = 50
MODEL = "models/gemini-embedding-2"

@retry(wait=wait_exponential(multiplier=1, min=2, max=10), stop=stop_after_attempt(5))
async def _embed_single(client: genai.Client, text: str, task_type: str) -> list[float]:
    """Embeds a single string with retry logic."""
    try:
        response = await client.aio.models.embed_content(
            model=MODEL,
            contents=text,
            config=types.EmbedContentConfig(task_type=task_type)
        )
        return response.embeddings[0].values
    except Exception as e:
        logger.warning(f"Embedding retry failed completely: {e}")
        return [0.0] * 3072

async def _embed_batch(client: genai.Client, texts: list[str], task_type: str) -> np.ndarray:
    """Sends a batch of individual requests concurrently."""
    tasks = [_embed_single(client, text, task_type) for text in texts]
    results = await asyncio.gather(*tasks)
    return np.array(results)

async def process_embeddings(texts: list[str], task_type: str) -> tuple[np.ndarray, int]:
    if not texts:
        return np.array([]), 0
        
    client = genai.Client(api_key=config.GEMINI_API_KEY)
    all_embeddings = []
    total_tokens = sum(len(t) // 4 for t in texts)
    
    # Process sequentially in chunks of 50 to avoid heavy RPM limits, 
    # but still fast due to batching multiple texts into one request.
    for i in range(0, len(texts), BATCH_SIZE):
        batch = texts[i:i + BATCH_SIZE]
        try:
            embeddings = await _embed_batch(client, batch, task_type)
            all_embeddings.append(embeddings)
        except Exception as e:
            logger.error(f"Embedding batch failed: {e}")
            all_embeddings.append(np.zeros((len(batch), 3072)))
            
    return np.vstack(all_embeddings), total_tokens

def cos_sim(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Compute cosine similarity between two matrices."""
    if len(a) == 0 or len(b) == 0:
        return np.array([])
    a_norm = a / np.linalg.norm(a, axis=1, keepdims=True)
    b_norm = b / np.linalg.norm(b, axis=1, keepdims=True)
    return np.dot(a_norm, b_norm.T)

async def _relevance_filter_async(items: list[NormalizedItem], queries: list[str]) -> tuple[list[ScoredItem], TokenUsage]:
    logger.info(f"Encoding {len(queries)} query variants with Gemini...")
    q_emb, q_tokens = await process_embeddings(queries, "RETRIEVAL_QUERY")
    
    # Extract full text natively without chunking (capped at ~7000 chars to safely respect 2048 tokens limit)
    doc_texts = []
    for item in items:
        text = f"{item.title}\n{item.text}" if item.title else item.text
        doc_texts.append(text[:7000])
        
    logger.info(f"Encoding {len(doc_texts)} full documents natively using Gemini async batching...")
    d_emb, doc_tokens = await process_embeddings(doc_texts, "RETRIEVAL_DOCUMENT")
    
    # Similarity check
    sim_matrix = cos_sim(d_emb, q_emb)
    max_sims = sim_matrix.max(axis=1)

    # --- DEBUG: Print the top 5 scores ---
    top_5_scores = sorted(float(s) for s in max_sims)[-5:]
    logger.info(f"Highest similarity scores in this batch: {[round(s, 4) for s in top_5_scores[::-1]]}")

    survivors: list[ScoredItem] = []
    survivor_indices = []
    
    # --- SAFETY NET LOGIC ---
    MIN_SURVIVORS = 50  # Ensure we always send at least 50 items to Dedup/Clustering
    
    # Create a list of tuples (index, score) and sort by score descending
    indexed_scores = sorted(enumerate(max_sims), key=lambda x: x[1], reverse=True)
    
    for rank, (i, sim) in enumerate(indexed_scores):
        score = float(sim)
        # Keep the item if it passes the threshold OR if we haven't hit our minimum survivor count
        if score >= config.RELEVANCE_THRESHOLD or rank < MIN_SURVIVORS:
            scored = ScoredItem(
                **items[i].model_dump(),
                relevance_score=score,
            )
            survivors.append(scored)
            survivor_indices.append(i)

    logger.info(
        f"Stage 1: {len(survivors)}/{len(items)} items passed "
        f"(Target Threshold={config.RELEVANCE_THRESHOLD}, Min Survivors={MIN_SURVIVORS})"
    )
    
    # Survivors are already sorted by relevance_score due to `indexed_scores`
    survivor_embeddings = d_emb[survivor_indices] if survivor_indices else np.array([])
    
    usage = TokenUsage(
        stage="s1_relevance",
        model=MODEL,
        prompt_tokens=q_tokens + doc_tokens,
        output_tokens=0,
        total_tokens=q_tokens + doc_tokens
    )
    return survivors, survivor_embeddings, usage


def relevance_filter(
    items: list[NormalizedItem],
    queries: list[str],
) -> tuple[list[ScoredItem], np.ndarray, TokenUsage]:
    """
    Stage 1 entry point using Gemini.
    """
    if not items or not queries:
        return [], np.array([]), TokenUsage(stage="s1_relevance", model=MODEL, prompt_tokens=0, output_tokens=0, total_tokens=0)

    return asyncio.run(_relevance_filter_async(items, queries))

async def _get_embeddings_async(items: list[ScoredItem]) -> tuple[np.ndarray, TokenUsage]:
    texts = [item.text[:7000] for item in items]
    embeddings, tokens = await process_embeddings(texts, "RETRIEVAL_DOCUMENT")
    
    usage = TokenUsage(
        stage="s3/s4_re_embed",
        model=MODEL,
        prompt_tokens=tokens,
        output_tokens=0,
        total_tokens=tokens
    )
    return embeddings, usage

def get_embeddings(items: list[ScoredItem]) -> tuple[np.ndarray, TokenUsage]:
    """
    Re-encode items for downstream stages (rerank, dedup, cluster).
    Returns (numpy array of shape (len(items), embedding_dim), TokenUsage).
    """
    if not items:
        return np.array([]), TokenUsage(stage="s3/s4_re_embed", model=MODEL, prompt_tokens=0, output_tokens=0, total_tokens=0)
    return asyncio.run(_get_embeddings_async(items))