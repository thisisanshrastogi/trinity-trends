# Entity Relationship Diagram

This document provides visual representations of the data relationships in Trinity Trends.

---

## Core ERD

```
┌──────────────────┐
│      users       │
├──────────────────┤
│ id          (PK) │
│ name             │
│ email       (UQ) │
│ created_at       │
└────────┬─────────┘
         │ 1:N
         ▼
┌──────────────────┐         ┌──────────────────────┐
│    sessions      │────────>│    intent_results     │
├──────────────────┤  1:1    ├──────────────────────┤
│ id          (PK) │         │ id              (PK) │
│ user_id     (FK) │         │ session_id      (FK) │
│ query            │         │ query                │
│ created_at       │         │ result_json          │
│ completed_at     │         │ created_at           │
└──┬───┬───┬───┬───┘         └──────────────────────┘
   │   │   │   │
   │   │   │   │  1:1        ┌──────────────────────┐
   │   │   │   └────────────>│  expansion_results   │
   │   │   │                 ├──────────────────────┤
   │   │   │                 │ id              (PK) │
   │   │   │                 │ session_id      (FK) │
   │   │   │                 │ seed                 │
   │   │   │                 │ result_json          │
   │   │   │                 │ candidate_count      │
   │   │   │                 │ created_at           │
   │   │   │                 └──────────────────────┘
   │   │   │
   │   │   │  1:N            ┌──────────────────────┐
   │   │   └────────────────>│   pipeline_runs      │
   │   │                     ├──────────────────────┤
   │   │                     │ id              (PK) │
   │   │                     │ session_id      (FK) │
   │   │                     │ stage                │
   │   │                     │ status               │
   │   │                     │ started_at           │
   │   │                     │ completed_at         │
   │   │                     │ error                │
   │   │                     │ result_summary       │
   │   │                     └──────────────────────┘
   │   │
   │   │  1:N                ┌──────────────────────┐
   │   └────────────────────>│     topics           │
   │                         ├──────────────────────┤
   │                         │ id         (PK,hash) │
   │                         │ text                 │
   │                         │ session_id      (FK) │
   │                         │ source               │
   │                         │ created_at           │
   │                         └──────────┬───────────┘
   │                                    │ 1:N
   │                                    ▼
   │                         ┌──────────────────────┐
   │                         │ topic_platform_ids   │
   │                         ├──────────────────────┤
   │                         │ topic_id        (FK) │
   │                         │ platform             │
   │                         │ platform_id          │
   │                         │ hashed_id       (UQ) │
   │                         └──────────────────────┘
   │
   │  1:N                    ┌──────────────────────┐
   ├────────────────────────>│  collector_results   │
   │                         ├──────────────────────┤
   │                         │ id              (PK) │
   │                         │ topic_id        (FK) │
   │                         │ session_id      (FK) │
   │                         │ platform             │
   │                         │ query                │
   │                         │ result_json          │
   │                         │ result_count         │
   │                         │ collected_at         │
   │                         └──────────────────────┘
   │
   │  1:1                    ┌──────────────────────┐
   ├────────────────────────>│   python_results     │
   │                         ├──────────────────────┤
   │                         │ id              (PK) │
   │                         │ session_id      (FK) │
   │                         │ result_json          │
   │                         │ created_at           │
   │                         └──────────────────────┘
   │
   │  1:N                    ┌──────────────────────┐
   └────────────────────────>│    token_usage       │
                             ├──────────────────────┤
                             │ id              (PK) │
                             │ session_id      (FK) │
                             │ stage                │
                             │ model                │
                             │ prompt_tokens        │
                             │ output_tokens        │
                             │ total_tokens         │
                             │ created_at           │
                             └──────────────────────┘
```

---

## Data Flow Through Tables

This diagram shows the order in which tables are populated during a pipeline run:

```
1. users              ← Created on first run (or fetched if existing)
      │
2. sessions           ← Created at pipeline start
      │
      ├─ 3. intent_results      ← Stage 1: Intent Analysis
      │       │
      │       └─ topics (source="intent")
      │
      ├─ 4. expansion_results   ← Stage 2: Expansion & Scoring
      │
      ├─ 5. topics (source="expansion")  ← Stage 3: Before collection
      │       │
      │       └─ collector_results       ← Stage 3: Per topic × platform
      │
      ├─ 6. python_results      ← Stage 4: Python pipeline output
      │
      ├─ 7. token_usage         ← Accumulated across all stages
      │
      └─ pipeline_runs          ← One per stage (tracks status)
```

---

## Cardinality Summary

| Relationship | Type | Description |
|-------------|------|-------------|
| users → sessions | 1:N | A user can run many analysis sessions |
| sessions → topics | 1:N | Each session discovers multiple topics |
| topics → topic_platform_ids | 1:N | A topic may appear on multiple platforms |
| sessions → pipeline_runs | 1:N | Each session has 4 pipeline stages |
| sessions → intent_results | 1:1 | One intent analysis per session |
| sessions → expansion_results | 1:1 | One expansion result per session |
| sessions → collector_results | 1:N | Multiple collections (topic × platform) |
| sessions → python_results | 1:1 | One final analysis per session |
| sessions → token_usage | 1:N | Multiple token records (per LLM call) |

---

## Key Design Patterns

### Hash-Based Topic IDs

```
Input:  "AI coding tools"
         │
         ▼
   toLowerCase() + trim()
         │
         ▼
   SHA-256 hash
         │
         ▼
   "a3f2c8..."  ← Used as topic ID
```

This ensures the same topic phrase always gets the same ID, enabling natural deduplication via `INSERT OR IGNORE`.

### Cascade Deletion

All tables use `ON DELETE CASCADE` from `sessions`. Deleting a session automatically cleans up:

```
DELETE FROM sessions WHERE id = ?
         │
         ├── topics (and their topic_platform_ids)
         ├── pipeline_runs
         ├── intent_results
         ├── expansion_results
         ├── collector_results
         ├── python_results
         └── token_usage
```