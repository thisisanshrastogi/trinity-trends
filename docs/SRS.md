# Software Requirements Specification

**Project:** Trinity Trends — A Pretty Trends Analyzer
**Version:** 1.0

---

## 1. Purpose

Trinity Trends is a multi-platform trend analysis engine that helps content creators discover actionable content opportunities by analyzing real-time data from social media and discussion platforms.

Given a topic or query, the system:

- Collects data from Reddit, YouTube, and Hacker News
- Applies NLP and ML techniques to filter, cluster, and score content
- Uses LLM-powered synthesis to produce structured "Trend Catchers" — actionable recommendations with suggested content, formats, angles, and deadlines

The system produces evidence-based recommendations backed by real platform metrics and cross-platform signal confirmation, not LLM hallucinations.

---

## 2. Goals

The system shall:

1. Accept a natural language topic and intelligently expand it into related search queries
2. Collect public data from multiple platforms without requiring platform API keys
3. Normalize cross-platform data into a unified representation
4. Filter, deduplicate, and cluster content using ML models (sentence-transformers, HDBSCAN)
5. Extract structured signals from clusters via LLM
6. Score and rank signals using multi-factor deterministic algorithms
7. Synthesize actionable trend recommendations using LLM with structured outputs
8. Persist all data and results for session management and historical lookup
9. Track LLM token usage for cost auditing
10. Provide a polished, interactive terminal interface

---

## 3. Non-Goals (Current Version)

The current version does not:

- Generate complete content automatically (it recommends what to create, not the content itself)
- Perform continuous monitoring or real-time alerts
- Support authenticated platform access (all collection is from public interfaces)
- Provide a web UI (CLI/TUI only)
- Support multi-user concurrent access (single-user, single-process)

---

## 4. Functional Requirements

### FR-1: Intent Analysis

The system shall classify user queries into intent categories (`topic`, `shopping`, `news`, `learning`, `brand`) and extract core topic phrases using Gemini with structured JSON output.

**Input:** Natural language query (e.g., "best AI coding tools 2024")
**Output:** `{ intent, category, confidence, topics[] }`

### FR-2: Query Expansion

The system shall expand extracted topics into semantically related search queries using three independent strategies:

| Strategy | Source |
|----------|--------|
| Google Autocomplete | Real search demand signals |
| LLM Subtopic Generation | Structural coverage of the topic space |
| Google Trends | Trending related queries |

Expansion results shall be deduplicated by normalized query text.

### FR-3: Semantic Scoring

The system shall rank expansion candidates by computing cosine similarity between Gemini embeddings of each candidate and the original query. Only the top-K candidates proceed to collection.

### FR-4: Data Collection

The system shall collect data from the following platforms without API keys:

| Platform | Method | Data Collected |
|----------|--------|---------------|
| Reddit | HTML scraping (`old.reddit.com`) | Posts with titles, bodies, scores, comments, authors, subreddits |
| YouTube | InnerTube API | Videos with titles, descriptions, view counts, channels |
| Hacker News | Algolia Search API | Stories and comments with points, comment counts |

Each collector shall support configurable limits, pagination, and filter parameters.

### FR-5: Data Normalization (Pipeline Stage 0)

The system shall convert platform-specific data into a unified `NormalizedItem` representation. Normalization includes:

- HTML/entity cleanup
- Bot and deleted content filtering
- Language detection (English only)
- Minimum word count enforcement
- Platform-weighted engagement scoring

### FR-6: Relevance Filtering & Reranking (Stages 1-2)

The system shall apply bi-encoder (sentence-transformers) relevance scoring followed by cross-encoder reranking to retain only topically relevant content.

### FR-7: Deduplication & Clustering (Stages 3-4)

The system shall:

- Remove near-duplicate content using MinHash LSH + cosine similarity
- Apply MMR diversification
- Cluster remaining items using HDBSCAN

### FR-8: Signal Extraction (Stage 5)

The system shall use Gemini to extract structured signals from each cluster:

- Entity (product/tool)
- Pain point
- Feature request
- Sentiment
- Intent
- Summary with representative quotes

### FR-9: Signal Scoring (Stages 6-7)

The system shall merge signals across clusters and compute multi-factor scores using deterministic algorithms:

- Relevance, evidence count, velocity, source spread, engagement, novelty

### FR-10: Trend Synthesis (Stage 9)

The system shall use Gemini with dynamic reasoning to generate Trend Catchers containing:

- Trend description and status (`rising` / `peaking`)
- Platform and metrics
- Suggested content, format, and angle
- Reference links and act-by deadline

### FR-11: Session Persistence

The system shall persist all pipeline data in SQLite:

- Users, sessions, topics, pipeline runs
- Intent results, expansion results, collector results
- Python analysis results, token usage

Sessions shall be resumable — the system shall skip completed stages when resuming.

### FR-12: Pipeline Checkpointing

The Python pipeline shall support partial execution via `--start-stage` and `--end-stage` flags, with intermediate state checkpointing via pickle serialization.

### FR-13: Token Usage Tracking

The system shall capture and persist `usageMetadata` from all Gemini API calls (both TypeScript and Python) for cost auditing.

### FR-14: Global CLI

The system shall register a global `trinity` command via `npm link`, accessible from any directory on the user's system.

---

## 5. Non-Functional Requirements

### Performance

| Scenario | Target |
|----------|--------|
| Intent analysis + expansion | < 10 seconds |
| Data collection (5 topics × 3 platforms) | < 60 seconds |
| Full Python pipeline (10 stages) | < 120 seconds |
| Session resumption (skipping completed stages) | < 5 seconds |

### Reliability

- Failed collectors shall not terminate the pipeline — partial results are processed
- Failed LLM calls shall fall back to metadata-only signals
- Pipeline state is checkpointed after each stage via pickle

### Extensibility

- Adding a new platform requires implementing a `Client` + `Parser` + `Collector` — no changes to the analysis pipeline
- Adding a new pipeline stage requires adding one file in `pipeline/stages/` and registering it in `runner.py`

### Portability

- Cross-platform: Linux, macOS, Windows
- Installer handles Python venv, Node dependencies, and CLI registration
- Only external dependency: Gemini API key

### Security

- All SQL queries use parameterized statements (no string interpolation)
- API keys stored in `.env` file (gitignored)
- No network listeners in CLI mode (Fastify server is a separate entry point)

---

## 6. System Architecture

```
User ──> CLI (TUI) ──> OrchestratorClient
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
        Intent Analysis  Expansion &    Data Collection
        (Gemini LLM)     Scoring        (Reddit, YouTube, HN)
                          (Gemini
                           Embeddings)
                              │
                              ▼
                     Python Pipeline (10 stages)
                              │
                              ▼
                     Trend Catchers (JSON)
                              │
                              ▼
                     SQLite Persistence
```

---

## 7. Target Users

- Content creators seeking data-driven topic selection
- Marketing teams analyzing competitive landscapes
- Developers evaluating technology trends
- Researchers monitoring discourse across platforms

---

## 8. Success Criteria

The system is successful when it consistently:

1. Identifies actionable trends supported by cross-platform evidence
2. Produces specific, non-generic content suggestions
3. Completes a full analysis in under 3 minutes
4. Enables session resumption without redundant computation
5. Provides transparent token usage for cost management