# Python Analysis Pipeline

This document provides a detailed breakdown of the 10-stage Python analysis pipeline that transforms raw collected data into actionable Trend Catchers.

---

## Overview

The pipeline is a **sequential, stage-gated processor**. Each stage takes the output of the previous stage as input and produces a progressively refined representation of the data. The pipeline supports partial execution and state checkpointing, allowing it to be paused and resumed at any stage boundary.

```
Raw Data ─> Normalize ─> Relevance ─> Rerank ─> Dedup ─> Cluster
                                                           │
Trend Catchers <─ Synthesize <─ Compress <─ Score <─ Merge <─ Extract
```

### Execution Model

```python
run_pipeline(
    input_path="output/{session}/collection-scored.json",
    output_path="output/{session}/analysis-result.json",
    start_stage=0,   # resume from any stage
    end_stage=9,      # stop at any stage
    state_file="output/{session}/pipeline_state.pkl"  # checkpoint
)
```

State is maintained as a Python dictionary and serialized via `pickle` between runs. This allows the most expensive stages (embedding, LLM calls) to be run once and their results reused.

---

## Stage 0: Normalize (`s0_normalize.py`)

**Input:** `CollectionScored` (raw JSON from TypeScript collectors)
**Output:** `list[NormalizedItem]` — flat, source-agnostic content items

### What it Does

Converts platform-specific data models (RedditPost, YouTubeVideo, HackerNewsPost) into a unified `NormalizedItem` schema:

```python
NormalizedItem(
    id="reddit_abc123",
    source="reddit",
    query="AI coding tools",
    text="Cleaned concatenated title + body",
    title="...",
    author="...",
    score=142,           # upvotes or views
    num_comments=37,
    engagement=216.0,    # weighted engagement metric
    ...
)
```

### Processing Steps

1. **HTML/Unicode Cleanup** — Strips HTML tags, decodes entities, removes raw URLs
2. **Boilerplate Removal** — Filters Reddit award edits (`Edit: thanks for the gold`)
3. **Bot Filtering** — Drops posts by known bot accounts (AutoModerator, RemindMeBot, etc.)
4. **Deleted Content** — Removes `[deleted]` and `[removed]` posts
5. **Language Detection** — Uses `langdetect` to keep only English content
6. **Minimum Length** — Drops items with fewer than `MIN_WORD_COUNT` words (default: 5)
7. **Engagement Normalization** — Applies platform-specific weights to make cross-platform scores comparable

### Platform Weights

YouTube views are orders of magnitude larger than Reddit upvotes, so raw scores cannot be compared directly:

```python
PLATFORM_WEIGHTS = {
    "reddit": 1.0,       # 1 upvote = 1.0 engagement
    "youtube": 0.001,    # 1000 views = 1.0 engagement
    "hackerNews": 1.0    # 1 point = 1.0 engagement
}
```

Reddit engagement = `score + (comments * 2)` — comments are weighted 2x because they indicate deeper engagement.

---

## Stage 1: Relevance Filter (`s1_relevance.py`)

**Input:** `list[NormalizedItem]`
**Output:** `list[ScoredItem]` — items augmented with `relevance_score` and `gemini-embedding-2` vectors

Uses the **`gemini-embedding-2`** model via an asynchronous batched approach to compute high-dimensional (3,072) cosine similarity between each item's text and all query variants. Items below the configured `RELEVANCE_THRESHOLD` are dropped.

**Safety Net Logic:** To prevent starving the downstream pipeline in cases of highly restrictive relevance scores, Stage 1 enforces a `MIN_SURVIVORS` floor (default 50). If fewer than 50 items pass the threshold, it admits the top 50 highest-scoring items regardless. The generated embeddings are passed downstream, eliminating the need to re-embed later.

---

## Stage 2: Rerank (`s2_rerank.py`)

*Note: This stage is currently BYPASSED in the production `runner.py` configuration.*

Historically applied a cross-encoder reranker. Due to the high semantic quality and 3,072 dimensionality of the `gemini-embedding-2` vectors generated in Stage 1, this stage is no longer strictly necessary for standard pipeline runs and is skipped to minimize latency.

---

## Stage 3: Dedup & Diversify (`s3_dedup.py`)

**Input:** `list[ScoredItem]` + embeddings
**Output:** `list[ScoredItem]` — deduplicated + diversified

### Semantic Deduplication (Vector-Based)

Replaces legacy string-matching (MinHash) with true semantic deduplication. Computes a pairwise similarity matrix using the Stage 1 `gemini-embedding-2` vectors. If two items exceed `DEDUP_SIMILARITY_THRESHOLD` (e.g., 0.88), they are flagged as semantic duplicates.

**Provenance Tracking:** Instead of permanently deleting duplicates, the pipeline merges them. The item with the highest engagement becomes the "representative", and the IDs of all merged duplicates are appended to its `evidence_ids` list. This guarantees the LLM synthesis accurately attributes consensus and volume.

### Diversification

After deduplication, the stage applies **Maximal Marginal Relevance (MMR)** using the pre-computed similarity matrix to ensure the final set is semantically diverse, preventing the output from being dominated by identical narratives.

---

## Stage 4: Cluster (`s4_cluster.py`)

**Input:** `list[ScoredItem]` + embeddings
**Output:** `list[ClusteredItem]`, `clusters` dict, and `noise_items` list

Uses **HDBSCAN** to group semantically similar items into subtopics. 

**Enhancements:**
- **L2 Normalization:** Embeddings are normalized to unit length before clustering, forcing HDBSCAN's Euclidean distance metric to behave precisely like Cosine Similarity.
- **Epsilon Hack:** Configured with `cluster_selection_epsilon=0.15` to act as a gravity well, pulling borderline items softly into nearby established clusters rather than instantly fragmenting them into noise.

Items that still fail to cluster are designated as anomalies (`label = -1`) and returned separately in a `noise_items` list for dedicated counter-trend analysis in Stage 5.

---

## Stage 5: Extract Signals (`s5_extract.py`)

**Input:** `dict[int, list[ClusteredItem]]` (clusters) and `list[ClusteredItem]` (noise)
**Output:** `list[ExtractedSignal]`

**This is the first of two LLM stages.** It iterates through a unified `work_queue` containing both mainstream clusters and the `noise_items` (-1 cluster). For each, it takes the top N items (sorted by **relevance score**) and queries Gemini using a Dual-Prompt strategy:

1. **Mainstream Clusters:** Analyzed via `_EXTRACTION_PROMPT` with `temperature=0.1` and `thinking_budget=0` to accurately extract consensus `entity`, `pain_point`, and `feature_request`.
2. **Anomalies (Noise):** Analyzed via `_ANOMALY_PROMPT` with `temperature=0.4` and `thinking_budget=1024`. This forces the LLM to analyze the noise *relative* to the mainstream, identifying early signals, contrarian perspectives, or niche innovations.

Both branches yield a unified `ExtractedSignal` structure:

```python
ExtractedSignal(
    cluster_id=3,                       # -1 for anomalies
    entity="Cursor",                    # product/tool mentioned
    pain_point="high latency on large codebases",
    feature_request="offline mode",
    sentiment="mixed",                  # positive | negative | neutral | mixed
    intent="comparison",                # purchase_evaluation | venting | question | ...
    summary="Users comparing Cursor vs Claude Code for daily coding workflows",
    evidence_count=14,
    sources=["reddit", "youtube"],
    representative_quotes=[...],
)
```

Employs **Defensive Parsing** to gracefully handle LLMs returning list structures instead of standard dictionaries, ensuring continuous execution without crash loops.

---

## Stage 6: Merge Signals (`s6_merge.py`)

**Input:** `list[ExtractedSignal]`
**Output:** `list[MergedSignal]`

Merges signals from different clusters that describe the same underlying phenomenon. For example, if clusters 3 and 7 both discuss "Cursor latency issues," they are merged into a single `MergedSignal` with combined evidence counts and aggregated metadata.

Merging uses:
- Entity string similarity
- Pain point / feature request overlap
- Cross-source confirmation (a signal appearing on both Reddit and YouTube is stronger)

---

## Stage 7: Score (`s7_score.py`)

**Input:** `list[MergedSignal]`
**Output:** `list[MergedSignal]` — with scoring components filled

Computes a multi-factor `final_score` for each signal:

| Component | Weight | Description |
|-----------|--------|-------------|
| `relevance_component` | High | Average bi-encoder relevance of underlying items |
| `evidence_component` | High | Number of independent data points supporting the signal |
| `velocity_component` | Medium | Temporal acceleration of discussion |
| `source_spread_component` | Medium | How many platforms the signal appears on |
| `engagement_component` | Medium | Average engagement across evidence items |
| `novelty_component` | Low | Preference for emerging vs. established signals |

The final score is a weighted sum, normalized to [0, 1].

---

## Stage 8: Compress (`s8_compress.py`)

**Input:** `list[MergedSignal]`
**Output:** `AnalysisOutput` — compressed payload for the final LLM

Reduces the pipeline output to fit within the LLM context window for synthesis:

1. Sorts signals by `final_score` descending
2. Extracts top pain points, feature requests, and questions across all signals
3. Selects representative quotes
4. Produces a statistics summary (total evidence, source distribution, etc.)

The output is a single `AnalysisOutput` object designed to be serialized to JSON and fed directly into the synthesis prompt.

---

## Stage 9: Synthesize (`s9_synthesize.py`)

**Input:** `AnalysisOutput`
**Output:** `FinalSynthesisOutput` — actionable Trend Catchers

**This is the second and final LLM stage.** It uses Gemini with advanced configuration:

- **Structured Outputs** — `response_schema=LLMSynthesisOutput` guarantees the response is valid JSON matching the Pydantic schema
- **Dynamic Reasoning** — `thinking_config=ThinkingConfig(thinking_level="high")` activates Gemini's extended reasoning mode for deeper analysis
- **Temperature 1.0** — Recommended setting when thinking mode is enabled

### Output Structure

```python
TrendCatcher(
    trend="AI Code Review Tools replacing manual PR reviews",
    platform="YouTube + Reddit",
    status="rising",           # rising | peaking
    metrics=TrendMetrics(
        impressions=45000,
        engagement_rate=0.034,
        velocity="accelerating",
    ),
    suggested_content="Benchmark Claude Code vs Cursor using a real production repository",
    format="comparison video",
    angle="Everyone shows success stories. Show where it fails.",
    reference_links=["https://reddit.com/r/...", "https://youtube.com/..."],
    act_by="2026-07-21",
)
```

### Prompt Engineering

The synthesis prompt is carefully structured with explicit sections:

1. **WHAT IS A TREND** — Defines criteria: engagement velocity, discussion volume, search interest, creator coverage, content gaps
2. **HOW TO DETERMINE STATUS** — Rules for `rising` vs `peaking` classification
3. **CONFIDENCE & SCORING** — Prioritizes multi-platform cross-confirmation over single viral posts
4. **CONTENT RECOMMENDATION** — Demands specific, actionable suggestions (not "make a video")
5. **ANGLE** — Requires a differentiating perspective

---

## Token Usage Tracking

Both LLM stages (s5 and s9) capture `usage_metadata` from Gemini responses and bundle `TokenUsage` records into the final output:

```python
TokenUsage(
    stage="extract_signals",
    model="gemini-2.5-flash",
    prompt_tokens=2847,
    output_tokens=312,
    total_tokens=3159,
)
```

These are ingested by the TypeScript orchestrator and persisted to the `token_usage` table in SQLite, enabling cost auditing across sessions.

---

## Error Handling

Each stage is designed to be fault-tolerant:

- **Stage 0:** Invalid items are silently dropped (logged at DEBUG level)
- **Stages 1-4:** If the transformer model fails, items pass through unscored
- **Stage 5:** If LLM extraction fails for a cluster, a fallback signal is created with raw metadata
- **Stage 9:** If synthesis fails entirely, an empty `FinalSynthesisOutput` is returned with the raw analysis attached

The pipeline never crashes on bad data — it degrades gracefully and logs warnings.
