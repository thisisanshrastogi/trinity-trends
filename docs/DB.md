# Database Schema

This document describes the SQLite database schema used by Trinity Trends for session persistence, pipeline tracking, and result storage.

**Database:** SQLite via `better-sqlite3` (TypeScript) and `sqlite3` (Python)
**Location:** `data/trinity_trends.db` (created automatically on first run)
**Mode:** WAL (Write-Ahead Logging) for concurrent read performance

---

## Tables

### users

Stores registered users who initiate analysis sessions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `name` | TEXT | NOT NULL | Display name |
| `email` | TEXT | UNIQUE | Email address |
| `created_at` | INTEGER | NOT NULL | Unix timestamp (ms) |

---

### sessions

Represents a single analysis pipeline execution.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `user_id` | TEXT | NOT NULL, FK → users | Owning user |
| `query` | TEXT | NOT NULL | Original search query |
| `created_at` | INTEGER | NOT NULL | Unix timestamp (ms) |
| `completed_at` | INTEGER | nullable | When the full pipeline finished |

A session may be resumed by passing its `id` back into the orchestrator. The system checks which pipeline stages have already been completed and resumes from the next one.

---

### topics

Canonical topic phrases extracted from intent analysis or query expansion.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | SHA-256 hash of normalized text |
| `text` | TEXT | NOT NULL | The topic phrase |
| `session_id` | TEXT | NOT NULL, FK → sessions | Associated session |
| `source` | TEXT | NOT NULL | `"intent"` or `"expansion"` |
| `created_at` | INTEGER | NOT NULL | Unix timestamp (ms) |

Topic IDs are deterministic hashes — inserting the same topic text twice is a no-op (`INSERT OR IGNORE`).

---

### topic_platform_ids

Maps topics to platform-specific identifiers for cross-referencing.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `topic_id` | TEXT | NOT NULL, FK → topics | Parent topic |
| `platform` | TEXT | NOT NULL | `"reddit"`, `"youtube"`, `"hackerNews"` |
| `platform_id` | TEXT | NOT NULL | Platform-native identifier |
| `hashed_id` | TEXT | NOT NULL, UNIQUE | SHA-256 of `platform:platform_id` |

Primary key: `(topic_id, platform, platform_id)`

---

### pipeline_runs

Tracks the execution status of each pipeline stage within a session.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `session_id` | TEXT | NOT NULL, FK → sessions | Parent session |
| `stage` | TEXT | NOT NULL | `"intent_analysis"`, `"topic_expansion"`, `"collection"`, `"python_analysis"` |
| `status` | TEXT | NOT NULL, DEFAULT `'pending'` | `"pending"`, `"running"`, `"completed"`, `"failed"` |
| `started_at` | INTEGER | NOT NULL | Unix timestamp (ms) |
| `completed_at` | INTEGER | nullable | When the stage finished |
| `error` | TEXT | nullable | Error message if failed |
| `result_summary` | TEXT | nullable | JSON summary of stage output |

Used by the orchestrator to determine which stages to skip when resuming a session.

---

### intent_results

Stores the LLM intent classification for a session's query.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `session_id` | TEXT | NOT NULL, UNIQUE, FK → sessions | One per session |
| `query` | TEXT | NOT NULL | The analyzed query |
| `result_json` | TEXT | NOT NULL | Full intent analysis JSON |
| `created_at` | INTEGER | NOT NULL | Unix timestamp (ms) |

The `result_json` contains: `{ intent, category, confidence, topics }`.

---

### expansion_results

Stores the scored expansion candidates for a session.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `session_id` | TEXT | NOT NULL, UNIQUE, FK → sessions | One per session |
| `seed` | TEXT | NOT NULL | Original query |
| `result_json` | TEXT | NOT NULL | Full expansion + scoring JSON |
| `candidate_count` | INTEGER | NOT NULL | Number of candidates generated |
| `created_at` | INTEGER | NOT NULL | Unix timestamp (ms) |

---

### collector_results

Stores raw data collected from each platform for each topic.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `topic_id` | TEXT | NOT NULL, FK → topics | Which topic this was collected for |
| `session_id` | TEXT | NOT NULL, FK → sessions | Parent session |
| `platform` | TEXT | NOT NULL | `"reddit"`, `"youtube"`, `"hackerNews"`, `"googleTrends"` |
| `query` | TEXT | NOT NULL | The search query used |
| `result_json` | TEXT | NOT NULL | Full platform response as JSON |
| `result_count` | INTEGER | NOT NULL | Number of items collected |
| `collected_at` | INTEGER | NOT NULL | Unix timestamp (ms) |

This is the largest table — each topic × platform combination produces one row. The `result_json` can be multiple megabytes for large collections.

---

### python_results

Stores the final output of the Python analysis pipeline.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `session_id` | TEXT | NOT NULL, UNIQUE, FK → sessions | One per session |
| `result_json` | TEXT | NOT NULL | Full `FinalSynthesisOutput` JSON |
| `created_at` | INTEGER | NOT NULL | Unix timestamp (ms) |

Contains the trend catchers, raw analysis, and token usage from the Python pipeline.

---

### token_usage

Tracks LLM token consumption across all pipeline stages for cost auditing.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | TEXT | PRIMARY KEY | UUID |
| `session_id` | TEXT | NOT NULL, FK → sessions | Parent session |
| `stage` | TEXT | NOT NULL | `"intent"`, `"expansion"`, `"extract_signals"`, `"synthesize"` |
| `model` | TEXT | NOT NULL | Model name (e.g., `"gemini-2.5-flash"`) |
| `prompt_tokens` | INTEGER | NOT NULL | Input tokens consumed |
| `output_tokens` | INTEGER | NOT NULL | Output tokens generated |
| `total_tokens` | INTEGER | NOT NULL | Total tokens |
| `created_at` | INTEGER | NOT NULL | Unix timestamp (ms) |

---

## Indexes

| Index | Table | Column(s) | Purpose |
|-------|-------|-----------|---------|
| `idx_sessions_user_id` | sessions | `user_id` | Look up sessions by user |
| `idx_topics_session_id` | topics | `session_id` | Look up topics by session |
| `idx_pipeline_runs_session_id` | pipeline_runs | `session_id` | Check completed stages |
| `idx_collector_results_topic_session` | collector_results | `(topic_id, session_id)` | Look up results by topic |
| `idx_collector_results_session` | collector_results | `session_id` | Look up all results for a session |
| `idx_topic_platform_ids_hashed` | topic_platform_ids | `hashed_id` | Cross-platform topic lookup |
| `idx_token_usage_session_id` | token_usage | `session_id` | Token audit by session |

---

## Entity Relationships

```
users
  │
  └─── 1:N ──── sessions
                    │
                    ├─── 1:N ──── topics
                    │                │
                    │                └─── 1:N ──── topic_platform_ids
                    │
                    ├─── 1:N ──── pipeline_runs
                    │
                    ├─── 1:1 ──── intent_results
                    │
                    ├─── 1:1 ──── expansion_results
                    │
                    ├─── 1:N ──── collector_results
                    │
                    ├─── 1:1 ──── python_results
                    │
                    └─── 1:N ──── token_usage
```

---

## Design Notes

1. **All IDs are UUIDs** generated via `crypto.randomUUID()`, except topic IDs which are SHA-256 hashes for natural deduplication.

2. **Timestamps are Unix milliseconds** (`Date.now()`), not ISO strings. This simplifies sorting and comparison.

3. **JSON columns store complete snapshots** — collector results store the entire platform response, not just summaries. This means the database is self-contained and the raw data can be re-analyzed without re-collecting.

4. **`INSERT OR REPLACE`** is used for single-per-session tables (intent, expansion, python results) so re-running a stage overwrites the previous result.

5. **Foreign keys are enforced** via `PRAGMA foreign_keys = ON` with `ON DELETE CASCADE`, so deleting a session cleans up all associated data.

6. **No ORM** — All queries are raw SQL via `better-sqlite3`'s synchronous API. This is intentional: the schema is simple enough that an ORM adds complexity without value.
