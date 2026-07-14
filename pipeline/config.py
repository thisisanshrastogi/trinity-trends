"""
Pipeline configuration — all tuneable knobs live here.
"""

from pathlib import Path
import os
from dotenv import dotenv_values

# Disable HuggingFace network calls
os.environ["HF_HUB_OFFLINE"] = "1"

# ── Paths ────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = PROJECT_ROOT / "output"
INPUT_FILE = OUTPUT_DIR / "collection-scored.json"
RESULT_FILE = OUTPUT_DIR / "analysis-result.json"

# ── Environment ──────────────────────────────────────────────────────────────
_env = dotenv_values(PROJECT_ROOT / ".env")
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY") or _env.get("GEMINI_API_KEY", "")

# ── Stage 0: Normalize ──────────────────────────────────────────────────────
MIN_WORD_COUNT = 15          # Drop items with fewer than this many words
TARGET_LANGUAGE = "en"       # ISO-639-1 code
LANGUAGE_CONFIDENCE = 0.8    # Minimum confidence for lang detection

# Base weight multipliers for engagement metrics across platforms
PLATFORM_WEIGHTS = {
    "youtube": 0.001,      # 1000 views = 1 base point
    "reddit": 1.0,         # 1 upvote = 1 base point
    "hackerNews": 2.0,     # HN engagement is denser, weight it slightly higher
}

# ── Stage 1: Relevance Filter ───────────────────────────────────────────────
BI_ENCODER_MODEL = "BAAI/bge-small-en-v1.5"
RELEVANCE_THRESHOLD = 0.35   # Cosine similarity cutoff

# ── Stage 2: Rerank ─────────────────────────────────────────────────────────
CROSS_ENCODER_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"
RERANK_TOP_N = 200           # Keep top N after reranking

# ── Stage 3: Dedup ──────────────────────────────────────────────────────────
MINHASH_THRESHOLD = 0.7      # SimHash/MinHash Jaccard threshold
MMR_LAMBDA = 0.7             # MMR relevance-diversity tradeoff (higher = more relevant)
MMR_TOP_K = 150              # Final items after MMR

# ── Stage 4: Cluster ────────────────────────────────────────────────────────
HDBSCAN_MIN_CLUSTER_SIZE = 3
HDBSCAN_MIN_SAMPLES = 2
HDBSCAN_METRIC = "euclidean"

# ── Stage 5: Extract & Stage 9: Synthesize ─────────────────────────────────
GEMINI_MODEL = "gemini-3.1-flash-lite"
MAX_DOCS_PER_CLUSTER = 10    # Top N docs (by engagement) sent to LLM per cluster

# ── Stage 6: Merge ──────────────────────────────────────────────────────────
MERGE_SIMILARITY_THRESHOLD = 0.85   # Cosine sim for merging duplicate signals

# ── Stage 7: Score ──────────────────────────────────────────────────────────
SCORE_WEIGHTS = {
    "relevance":     0.30,
    "evidence_count": 0.20,
    "velocity":      0.15,
    "source_spread":  0.15,
    "engagement":    0.10,
    "novelty":       0.10,
}
