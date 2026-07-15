```
████████╗██████╗ ██╗███╗   ██╗██╗████████╗██╗   ██╗
╚══██╔══╝██╔══██╗██║████╗  ██║██║╚══██╔══╝╚██╗ ██╔╝
   ██║   ██████╔╝██║██╔██╗ ██║██║   ██║    ╚████╔╝ 
   ██║   ██╔══██╗██║██║╚██╗██║██║   ██║     ╚██╔╝  
   ██║   ██║  ██║██║██║ ╚████║██║   ██║      ██║   
   ╚═╝   ╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝╚═╝   ╚═╝      ╚═╝   
 ████████╗██████╗ ███████╗███╗   ██╗██████╗ ███████╗
 ╚══██╔══╝██╔══██╗██╔════╝████╗  ██║██╔══██╗██╔════╝
    ██║   ██████╔╝█████╗  ██╔██╗ ██║██║  ██║███████╗
    ██║   ██╔══██╗██╔══╝  ██║╚██╗██║██║  ██║╚════██║
    ██║   ██║  ██║███████╗██║ ╚████║██████╔╝███████║
    ╚═╝   ╚═╝  ╚═╝╚══════╝╚═╝  ╚═══╝╚═════╝ ╚══════╝
                                    - A Pretty Trends Analyzer -
```

# Trinity Trends

**An intelligent, multi-platform trend analysis engine that scrapes real-time data from Reddit, YouTube, and Hacker News, then runs it through a 10-stage AI pipeline to surface actionable content opportunities.**

Trinity Trends is a hybrid TypeScript + Python CLI application. The TypeScript layer handles data collection, intent analysis, query expansion, and semantic scoring. The Python layer runs a deep analysis pipeline — normalization, relevance filtering, clustering, signal extraction, and LLM-powered trend synthesis — to produce structured, publication-ready "Trend Catchers."

---

## Table of Contents

- [Features](#features)
- [Architecture at a Glance](#architecture-at-a-glance)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [Project Structure](#project-structure)
- [Configuration](#configuration)
- [Building a Release](#building-a-release)
- [Uninstalling](#uninstalling)
- [Documentation](#documentation)
- [License](#license)

---

## Features

- **Multi-Platform Collection** — Scrapes Reddit (via old.reddit.com HTML parsing), YouTube (via InnerTube API), and Hacker News (via Algolia API) without requiring any API keys for those platforms.
- **LLM-Powered Intent Analysis** — Uses Gemini to classify user queries and extract core topic phrases before expansion.
- **Smart Query Expansion** — Combines three independent expansion strategies (Google Autocomplete, LLM subtopic generation, Google Trends) and deduplicates results.
- **Semantic Scoring** — Ranks expanded candidates using Gemini embeddings and cosine similarity against the original query.
- **10-Stage Python Pipeline** — Normalize → Relevance Filter → Rerank → Dedup → Cluster → Extract Signals → Merge → Score → Compress → Synthesize.
- **Trend Catchers** — The final synthesis stage uses Gemini with structured outputs and dynamic reasoning to generate actionable content recommendations with metrics, suggested formats, angles, and deadlines.
- **Session Management** — Full SQLite persistence with session resuming, token usage tracking, and pipeline stage checkpointing via pickle.
- **Interactive TUI** — A polished terminal interface built with `@clack/prompts`, `picocolors`, and `figlet` for a premium CLI experience.
- **Global CLI** — Install once, run `trinity` from any directory on your machine.

---

## Architecture at a Glance

```
                          User Query
                              |
                    +---------v---------+
                    |   Intent Analysis  |  Gemini LLM
                    |  (classify + extract topics)
                    +---------+---------+
                              |
                    +---------v---------+
                    |  Query Expansion   |  Autocomplete + LLM + Trends
                    |  + Semantic Scoring |  Gemini Embeddings
                    +---------+---------+
                              |
              +---------------v---------------+
              |       Data Collection          |
              |  Reddit | YouTube | HackerNews |
              +---------------+---------------+
                              |
                    +---------v---------+
                    |  Python Pipeline   |  10 stages
                    |  (normalize, filter,|
                    |   cluster, extract, |
                    |   score, synthesize)|
                    +---------+---------+
                              |
                    +---------v---------+
                    |   Trend Catchers   |  Actionable output
                    +-------------------+
```

---

## Prerequisites

| Dependency | Version | Purpose |
|------------|---------|---------|
| **Node.js** | >= 18 | TypeScript runtime, CLI, collectors |
| **Python** | >= 3.10 | Analysis pipeline, ML models |
| **Gemini API Key** | — | Intent analysis, embeddings, signal extraction, synthesis |

---

## Installation

### From Source

```bash
# 1. Clone the repository
git clone https://github.com/your-org/trinity-trends.git
cd trinity-trends

# 2. Run the cross-platform installer
node install.js
```

The installer will:
1. Create a `.env` file and prompt you for your `GEMINI_API_KEY`
2. Create a Python virtual environment in `pipeline/.venv`
3. Install all Python dependencies (sentence-transformers, hdbscan, lancedb, etc.)
4. Install Node.js dependencies
5. Compile the TypeScript source
6. Register the `trinity` command globally via `npm link`

### From a Release Package

```bash
# 1. Download and extract the release
tar -xzf trinity-trends-v1.0.27.tar.gz
cd trinity-trends-v1.0.27

# 2. Run the installer
node install.js
```

---

## Usage

After installation, start the TUI from anywhere:

```bash
trinity
```

### Main Menu

The interactive menu offers:

| Option | Description |
|--------|-------------|
| **New Pipeline** | Start a fresh analysis — enter a topic, configure collector filters, and run the full pipeline |
| **Resume Session** | Pick up where you left off with an existing session |
| **View Results** | Inspect intent analysis, expansion candidates, collected data, and trend catchers |
| **View Token Usage** | Audit LLM token consumption across all pipeline stages |
| **Exit** | Gracefully exit with a farewell banner and an inspirational quote |

### Example Flow

```
$ trinity

  ████████╗██████╗ ██╗███╗   ██╗██╗████████╗██╗   ██╗
  ...
  - A Pretty Trends Analyzer -

  > New Pipeline
  ? Enter your search topic: AI coding assistants
  ? Reddit post limit: 10
  ? YouTube video limit: 10
  ...

  [Orchestrator] Stage 1/4: Intent Analysis
  [Orchestrator] Stage 2/4: Topic Expansion & Scoring
  [Orchestrator] Stage 3/4: Data Collection (Top 5 candidates)
  [Orchestrator] Stage 4/4: Python Pipeline Analysis
    → Stage 0: 127 items normalized
    → Stage 1: 89 items passed relevance
    ...
    → Stage 9: synthesized

  PIPELINE COMPLETE — AI coding assistants
  Trend Catchers:     6
  Signals found:      12
```

---

## Project Structure

```
trinity-trends/
├── src/                        # TypeScript source
│   ├── app/                    # CLI, orchestrator, server
│   │   ├── cli.ts              # Interactive TUI (entry point)
│   │   ├── orchestrator.client.ts  # Pipeline orchestration
│   │   ├── bootstrap.ts        # Fastify web server (optional)
│   │   └── config.ts           # App configuration
│   ├── collectors/             # Platform scrapers
│   │   ├── reddit/             # old.reddit.com HTML scraper
│   │   ├── youtube/            # InnerTube API client
│   │   ├── hackerNews/         # Algolia HN search API
│   │   └── googleTrends/       # Google Trends API wrapper
│   ├── intent/                 # LLM intent classification
│   ├── expansion/              # Query expansion strategies
│   ├── semantic/               # Embedding & scoring
│   ├── storage/                # SQLite + LanceDB persistence
│   │   ├── sqlite/             # SQLite client & repository
│   │   └── lance/              # LanceDB vector store
│   ├── common/                 # Shared utilities
│   │   ├── llm/                # Gemini caller, factory, tracing
│   │   └── http/               # HTTP client utilities
│   └── types/                  # Shared TypeScript types
│
├── pipeline/                   # Python analysis pipeline
│   ├── stages/                 # 10 processing stages (s0–s9)
│   │   ├── s0_normalize.py     # Flatten & clean raw data
│   │   ├── s1_relevance.py     # Bi-encoder relevance scoring
│   │   ├── s2_rerank.py        # Cross-encoder reranking
│   │   ├── s3_dedup.py         # MinHash + cosine deduplication
│   │   ├── s4_cluster.py       # HDBSCAN clustering
│   │   ├── s5_extract.py       # LLM signal extraction
│   │   ├── s6_merge.py         # Cross-cluster signal merging
│   │   ├── s7_score.py         # Multi-factor scoring
│   │   ├── s8_compress.py      # Payload compression for LLM
│   │   └── s9_synthesize.py    # Final trend synthesis (Gemini)
│   ├── storage/                # Python SQLite & LanceDB clients
│   ├── models.py               # Pydantic data models
│   ├── runner.py               # Pipeline orchestrator
│   ├── config.py               # Pipeline configuration
│   └── pyproject.toml          # Python package definition
│
├── docs/                       # Architecture documentation
├── scripts/                    # Build & deployment scripts
│   └── build.js                # Release packager
├── install.js                  # Cross-platform installer
├── uninstall.js                # Clean uninstaller
├── package.json                # Node.js manifest
└── tsconfig.json               # TypeScript configuration
```

---

## Configuration

### Environment Variables

Create a `.env` file (the installer does this automatically):

```env
GEMINI_API_KEY=your_gemini_api_key_here
```

### Python Pipeline Config

Pipeline behavior is controlled via `pipeline/config.py`:

| Setting | Default | Description |
|---------|---------|-------------|
| `TARGET_LANGUAGE` | `"en"` | Language filter for normalization |
| `MIN_WORD_COUNT` | `5` | Minimum words for a document to survive filtering |
| `GEMINI_MODEL` | `"gemini-2.5-flash"` | Model used for signal extraction and synthesis |
| `MAX_DOCS_PER_CLUSTER` | `10` | Documents sent to LLM per cluster |
| `PLATFORM_WEIGHTS` | `{"reddit": 1.0, "youtube": 0.001, "hackerNews": 1.0}` | Engagement normalization weights |

---

## Building a Release

To package the project for distribution:

```bash
node scripts/build.js
```

This will:
1. Clean previous builds
2. Compile TypeScript
3. Set executable permissions on the CLI
4. Copy source, pipeline, and config files into a distribution folder
5. Compress everything into `dist_release/trinity-trends-v{VERSION}.tar.gz`

The resulting archive contains everything an end user needs — they just extract it and run `node install.js`.

---

## Uninstalling

To cleanly remove Trinity Trends:

```bash
# From inside the project directory
node uninstall.js

# Then delete the folder
rm -rf trinity-trends-v*/
```

This removes the global `trinity` command. Your local `data/` and `output/` folders (containing SQLite databases and analysis results) are left untouched so you don't lose your work.

---

## Documentation

Detailed architecture and design documentation lives in the `docs/` directory:

| Document | Contents |
|----------|----------|
| [`docs/architecture.md`](docs/architecture.md) | System architecture, data flow, and component interactions |
| [`docs/pipeline.md`](docs/pipeline.md) | Deep dive into the 10-stage Python analysis pipeline |
| [`docs/design-decisions.md`](docs/design-decisions.md) | Key design decisions and their rationale |
| [`docs/DB.md`](docs/DB.md) | Database schema reference |
| [`docs/ERD.md`](docs/ERD.md) | Entity-relationship diagrams |

---

## License

This project is private and not currently published under an open-source license.
