# Architecture

This document describes the overall system architecture of Trinity Trends, how the TypeScript and Python layers interact, and the responsibilities of each major component.

---

## System Overview

Trinity Trends is a **hybrid TypeScript + Python** application designed as a two-phase pipeline:

1. **Phase 1 (TypeScript)** — Understanding, expansion, and collection
2. **Phase 2 (Python)** — Deep analysis, clustering, and synthesis

The two phases communicate through a JSON file on disk (`collection-scored.json`) and are orchestrated by a central `OrchestratorClient` class.

```
┌─────────────────────────────────────────────────────────────────────┐
│                         TRINITY TRENDS                              │
├──────────────────────────────┬──────────────────────────────────────┤
│     TypeScript Layer         │         Python Layer                  │
│                              │                                      │
│  ┌──────────────┐            │    ┌──────────────────────────────┐  │
│  │  CLI (TUI)   │            │    │  Pipeline Runner             │  │
│  └──────┬───────┘            │    │  (10 stages: s0 — s9)        │  │
│         │                    │    └──────────────┬───────────────┘  │
│  ┌──────v───────┐            │                   │                  │
│  │ Orchestrator  │───JSON───>│    ┌──────────────v───────────────┐  │
│  │   Client      │<──JSON───│    │  Pydantic Models             │  │
│  └──────┬───────┘            │    └──────────────────────────────┘  │
│         │                    │                                      │
│  ┌──────v───────┐            │    ┌──────────────────────────────┐  │
│  │ Intent       │            │    │  Storage (SQLite + LanceDB)  │  │
│  │ Expansion    │            │    └──────────────────────────────┘  │
│  │ Scoring      │            │                                      │
│  └──────┬───────┘            │                                      │
│         │                    │                                      │
│  ┌──────v───────┐            │                                      │
│  │ Collectors   │            │                                      │
│  │ (Reddit,     │            │                                      │
│  │  YouTube,    │            │                                      │
│  │  HackerNews) │            │                                      │
│  └──────────────┘            │                                      │
│                              │                                      │
│  ┌──────────────┐            │                                      │
│  │ Storage      │            │                                      │
│  │ (SQLite +    │            │                                      │
│  │  LanceDB)    │            │                                      │
│  └──────────────┘            │                                      │
├──────────────────────────────┴──────────────────────────────────────┤
│                     Shared: .env, output/, data/                    │
└─────────────────────────────────────────────────────────────────────┘
```

---

## TypeScript Layer

### Entry Points

| File | Role |
|------|------|
| `src/app/cli.ts` | Interactive TUI — the primary user-facing entry point registered as the `trinity` global command |
| `src/app/bootstrap.ts` | Fastify HTTP server — an alternative entry point for programmatic/API access |

### Orchestrator (`src/app/orchestrator.client.ts`)

The `OrchestratorClient` is the central conductor. It coordinates the four TypeScript pipeline stages:

1. **Intent Analysis** — Calls `LLMIntentAnalyzer` to classify the query (topic, shopping, news, learning, brand) and extract core topic phrases.
2. **Expansion & Scoring** — Runs three expanders in parallel, deduplicates results, and scores candidates using Gemini embeddings.
3. **Data Collection** — For each top-K candidate, collects data from Reddit, YouTube, and Hacker News in parallel.
4. **Python Handoff** — Serializes collected data to JSON, spawns the Python pipeline as a child process, and ingests the results back into SQLite.

Key design: The orchestrator dynamically resolves the installation root directory using `import.meta.url`, enabling the `trinity` command to work from any working directory on the user's system.

### Intent Analysis (`src/intent/`)

Uses Gemini with JSON Schema enforcement to produce structured output:

```typescript
{
  category: "Technology",   // domain classification
  intent: "topic",          // topic | shopping | news | learning | brand
  confidence: 0.92,         // 0-1 confidence score
  topics: ["rust programming"]  // distilled topic phrases
}
```

Two LLM calls run in parallel: intent classification and topic extraction. Both use `responseSchema` to guarantee valid JSON from the model.

### Query Expansion (`src/expansion/`)

Three independent expanders run concurrently for each extracted topic:

| Expander | Strategy | Signal Type |
|----------|----------|-------------|
| `GoogleAutocompleteExpander` | Scrapes Google's autocomplete suggestions | Demand signal |
| `LLMSubtopicExpander` | Uses Gemini to generate semantically related subtopics | Structural signal |
| `TrendsExpander` | Queries Google Trends for related queries | Demand signal |

The `ExpansionService` deduplicates results across all topic × expander combinations, producing a flat list of `Candidate` objects.

### Semantic Scoring (`src/semantic/`)

The `ExpansionScorer` embeds both the original query and all expansion candidates using Gemini's embedding model (`gemini-embedding-2`), then ranks candidates by cosine similarity. This ensures only the most semantically relevant expansions proceed to collection.

Batching is set to 50 concurrent embedding requests to avoid connection timeouts.

### Collectors (`src/collectors/`)

All collectors are **API-key-free** — they work by scraping public interfaces:

| Collector | Method | Pagination |
|-----------|--------|------------|
| **Reddit** | HTML scraping of `old.reddit.com/search` | Cursor-based (`after` parameter) |
| **YouTube** | Initial HTML page + InnerTube continuation API | Continuation tokens |
| **Hacker News** | Algolia Search API (`hn.algolia.com`) | Page-based |

Each collector follows the same pattern: `Client` (HTTP requests) → `Parser` (HTML/JSON → typed objects) → `Collector` (pagination + orchestration).

### Storage (`src/storage/`)

Two storage backends:

- **SQLite** (`better-sqlite3`) — Synchronous, WAL-mode database for structured data. Schema migrations run automatically on first connection. Tables: `users`, `sessions`, `topics`, `pipeline_runs`, `intent_results`, `expansion_results`, `collector_results`, `python_results`, `token_usage`.
- **LanceDB** — Vector database for semantic search (used during expansion scoring).

### LLM Infrastructure (`src/common/llm/`)

- **`GeminiFactory`** — Creates scoped `GeminiCaller` instances for different pipeline stages (intent, expansion, etc.)
- **`GeminiCaller`** — Wraps the `@google/genai` SDK with tracing support
- **`Tracer` / `ConsoleTracer`** — Lightweight tracing interface for timing and logging LLM calls
- **`SessionTokenTracer`** — Captures `usageMetadata` from Gemini responses and persists it to SQLite for cost auditing

---

## Python Layer

### Pipeline Runner (`pipeline/runner.py`)

The runner orchestrates 10 sequential stages (s0–s9), each implemented as a pure function that transforms the pipeline state. It supports:

- **Partial execution** via `--start-stage` and `--end-stage` flags
- **State checkpointing** via pickle serialization to `pipeline_state.pkl`
- **Resumption** — load a pickled state and resume from any stage

### Data Models (`pipeline/models.py`)

All inter-stage data is defined as Pydantic models, providing:
- Type validation at every stage boundary
- Easy JSON serialization for the final output
- Clear documentation of what each stage produces

### Pipeline Stages

See [`docs/pipeline.md`](pipeline.md) for a detailed breakdown of each stage.

### Storage (`pipeline/storage/`)

The Python layer has its own storage clients (mirroring the TypeScript interfaces):
- `sqlite_client.py` — Read/write pipeline metadata and results
- `lance_client.py` — Vector storage for embedding-based operations

---

## Cross-Language Bridge

The TypeScript and Python layers communicate through:

1. **JSON on disk** — The orchestrator writes `collection-scored.json` and reads `analysis-result.json`
2. **Child process** — Python is spawned via `execSync` with `stdio: 'inherit'` for real-time log streaming
3. **Pickle state** — The Python pipeline persists intermediate state to `pipeline_state.pkl` for resumption
4. **Shared `.env`** — Both layers read `GEMINI_API_KEY` from the same `.env` file (TypeScript via `process.loadEnvFile()`, Python via `python-dotenv`)

### Path Resolution

When the `trinity` command runs globally, the orchestrator resolves paths using `import.meta.url` to find the installation root:

```typescript
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

let installRoot = __dirname;
while (!fs.existsSync(path.join(installRoot, 'package.json'))) {
    installRoot = path.dirname(installRoot);
}
```

This ensures the Python virtual environment (`pipeline/.venv`) and module paths are always found correctly, regardless of the user's current working directory.

---

## Data Flow Summary

```
User Input ("AI coding assistants")
    │
    ├─> Intent Analysis ──> { intent: "topic", topics: ["AI coding tools"] }
    │
    ├─> Expansion ──> 15-30 candidate queries
    │
    ├─> Semantic Scoring ──> Top 5 candidates ranked by relevance
    │
    ├─> Collection ──> ~50-150 posts/videos per candidate
    │   ├─ Reddit: paginated HTML scraping
    │   ├─ YouTube: InnerTube API + player metadata enrichment
    │   └─ Hacker News: Algolia search API
    │
    ├─> collection-scored.json (written to disk)
    │
    ├─> Python Pipeline (10 stages)
    │   ├─ s0: Normalize to flat items
    │   ├─ s1: Relevance filter (bi-encoder)
    │   ├─ s2: Rerank (cross-encoder)
    │   ├─ s3: Dedup (MinHash + cosine)
    │   ├─ s4: Cluster (HDBSCAN)
    │   ├─ s5: Extract signals (Gemini LLM)
    │   ├─ s6: Merge signals across clusters
    │   ├─ s7: Score (multi-factor)
    │   ├─ s8: Compress for LLM context window
    │   └─ s9: Synthesize Trend Catchers (Gemini + thinking)
    │
    ├─> analysis-result.json (written to disk)
    │
    └─> SQLite (persisted for session management)
```
