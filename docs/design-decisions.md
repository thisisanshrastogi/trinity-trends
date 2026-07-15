# Design Decisions

This document explains the key architectural and technical decisions made during the development of Trinity Trends, including the rationale behind each choice and alternatives that were considered.

---

## 1. Hybrid TypeScript + Python Architecture

### Decision
Split the application into a TypeScript collection layer and a Python analysis layer, communicating via JSON files on disk.

### Rationale
- **TypeScript excels at I/O-bound work** — HTTP scraping, HTML parsing, and concurrent API requests. The ecosystem (Cheerio, Axios) is mature and fast for web scraping.
- **Python excels at ML/NLP** — sentence-transformers, HDBSCAN, and the Google GenAI SDK have first-class Python support. Many models are Python-only.
- **Decoupling** — Either layer can be developed, tested, and debugged independently. The JSON contract between them is simple and inspectable.

### Alternatives Considered
- **All-TypeScript** — Would have required porting sentence-transformers and HDBSCAN to JS (no good equivalents exist).
- **All-Python** — Would have meant rewriting the scraping layer. Python's async scraping (aiohttp + BeautifulSoup) is more verbose than the TypeScript approach.
- **gRPC/HTTP bridge** — Rejected as overengineered for a CLI tool. JSON files are simpler, debuggable, and require no server process.

---

## 2. API-Key-Free Data Collection

### Decision
All platform collectors (Reddit, YouTube, Hacker News) work without API keys by scraping public-facing interfaces.

### Rationale
- **Zero friction for end users** — The only API key required is for Gemini (which powers the intelligence layer). Users don't need to register developer accounts on Reddit, YouTube, or Google.
- **No rate limit quotas** — Official APIs impose strict rate limits. Scraping public pages allows more flexible collection within reasonable bounds.

### Implementation Details
| Platform | Interface | Why This Interface |
|----------|-----------|-------------------|
| Reddit | `old.reddit.com` HTML | Simpler DOM structure than new Reddit. No JavaScript rendering needed. |
| YouTube | Initial HTML + InnerTube API | The search page embeds `ytInitialData` JSON. Continuation uses the internal InnerTube endpoint (same as youtube.com itself). |
| Hacker News | Algolia API (`hn.algolia.com`) | Fully public, well-documented, supports complex queries. No auth needed. |

### Trade-offs
- Scrapers can break if platform HTML changes (mitigated by isolated parser modules that are easy to update)
- No access to private/authenticated data
- Must be respectful of request volume

---

## 3. Collector Pattern: Client → Parser → Collector

### Decision
Each platform follows a three-layer pattern: `Client` (HTTP) → `Parser` (extraction) → `Collector` (pagination + orchestration).

### Rationale
- **Testability** — Each layer can be tested independently. Parsers can be tested with saved HTML fixtures. Clients can be mocked.
- **Single Responsibility** — The client handles HTTP concerns (headers, retries), the parser handles DOM/JSON extraction, and the collector handles business logic (pagination, dedup, enrichment).
- **Interface-first design** — Each component has a `*Like` interface (e.g., `RedditClientLike`), enabling dependency injection in tests.

---

## 4. Three-Strategy Query Expansion

### Decision
Use three independent expansion strategies (autocomplete, LLM subtopic, Google Trends) running in parallel, with semantic deduplication.

### Rationale
Each strategy captures a different type of signal:

| Strategy | Signal Type | Why |
|----------|------------|-----|
| Google Autocomplete | **Demand** | Shows what real users are actively searching for |
| LLM Subtopic | **Structure** | Generates semantically related subtopics that users might not think to search for |
| Google Trends | **Demand** | Surfaces trending related queries with temporal momentum |

Running all three in parallel with `Promise.allSettled` means a single strategy's failure (e.g., Google Trends API down) doesn't block the pipeline.

### Deduplication
Candidates are deduplicated by normalized query string across all strategies. This prevents the same concept from appearing twice just because autocomplete and the LLM both suggested it.

---

## 5. Semantic Scoring with Gemini Embeddings

### Decision
Rank expansion candidates using Gemini's embedding model (`gemini-embedding-2`) with cosine similarity against the original query.

### Rationale
- **Quality over quantity** — Not all expanded queries are equally relevant. A query about "AI coding tools" might expand to "best keyboards for programmers" (topically adjacent but not relevant).
- **Gemini embeddings** — Using the same model family as the rest of the pipeline ensures semantic consistency.
- **Batch size 50** — A practical balance between throughput and network stability. Batch size 100 caused connection timeouts.

---

## 6. HDBSCAN Clustering (Stage 4)

### Decision
Use HDBSCAN instead of K-means for clustering collected content.

### Rationale
- **No k required** — K-means requires specifying the number of clusters upfront. With trend analysis, we don't know how many distinct themes exist in the data.
- **Noise handling** — HDBSCAN labels items that don't fit any cluster as noise (`cluster_id = -1`). These are discarded, acting as an additional quality filter.
- **Variable density** — Some themes have 50 data points, others have 3. HDBSCAN handles this naturally.

---

## 7. MinHash + Cosine Deduplication (Stage 3)

### Decision
Use a two-pass deduplication strategy: fast MinHash LSH first, then precise cosine similarity within buckets.

### Rationale
- **MinHash LSH is O(n)** for approximate nearest neighbor — it scales to thousands of items without computing all pairwise similarities.
- **Cosine similarity is expensive** but accurate — running it only within MinHash buckets keeps the total computation manageable.
- **MMR diversification** — After dedup, Maximal Marginal Relevance ensures the surviving items are not just unique but diverse.

### Why Not Just Cosine?
For 500+ items, all-pairs cosine similarity is O(n²) and takes several seconds. MinHash pre-grouping reduces the actual comparison set by ~90%.

---

## 8. Two-LLM-Stage Pipeline Design

### Decision
Only two of the 10 pipeline stages use LLM calls (Stage 5: Extract, Stage 9: Synthesize). All other stages use deterministic algorithms.

### Rationale
- **Cost control** — LLM calls are the most expensive operation. Minimizing them keeps the pipeline affordable.
- **Reproducibility** — Deterministic stages (normalize, filter, cluster, score) produce identical output for identical input. Only the LLM stages introduce non-determinism.
- **Debuggability** — When something goes wrong, 8 out of 10 stages can be debugged by inspecting data alone, without wondering "what did the LLM decide?"

### Stage 5 vs Stage 9
- **Stage 5 (Extract)** uses `thinking_budget=0` — it's a straightforward information extraction task where extended reasoning adds no value.
- **Stage 9 (Synthesize)** uses `thinking_level="high"` — trend identification benefits from the model's ability to reason across multiple signals and make judgment calls.

---

## 9. Source-Based Distribution (Not Binary)

### Decision
Distribute the Python pipeline as source code with a virtual environment, rather than compiling it into a binary using PyInstaller or similar tools.

### Rationale
- **Size** — The sentence-transformers model alone is ~90MB. A PyInstaller binary would be 500MB+. Source + venv is ~200MB.
- **Transparency** — Users can inspect and modify the pipeline stages.
- **Reliability** — PyInstaller has known issues with NumPy, PyTorch, and other ML libraries on different platforms.

### Trade-off
Users must have Python 3.10+ installed. The installer handles venv creation automatically, so the user doesn't need to know pip.

---

## 10. SQLite for Session Persistence

### Decision
Use SQLite (via `better-sqlite3` in TypeScript, raw `sqlite3` in Python) as the primary structured data store.

### Rationale
- **Zero configuration** — No database server to install or manage.
- **Single file** — The entire database is one file (`data/trinity_trends.db`), easy to back up or move.
- **WAL mode** — Write-Ahead Logging provides good concurrent read performance.
- **Synchronous API** — `better-sqlite3` is intentionally synchronous, which simplifies the repository layer enormously compared to async alternatives.

### Schema Design
- **Parameterized queries everywhere** — No string interpolation in SQL. Every value goes through `?` placeholders.
- **Hash-based IDs** — Topic IDs are SHA-256 hashes of the normalized text, providing natural deduplication.
- **Foreign keys enforced** — `PRAGMA foreign_keys = ON` ensures referential integrity.

---

## 11. Global CLI via `npm link`

### Decision
Use `npm link` to register a global `trinity` command, rather than distributing a standalone binary.

### Rationale
- **Cross-platform** — `npm link` works on Linux, macOS, and Windows. On Windows, it automatically creates `.cmd` wrapper scripts.
- **No compilation** — Unlike Go or Rust binaries, no cross-compilation step is needed.
- **Familiar toolchain** — Anyone with Node.js already understands `npm link`.

### Path Resolution
The biggest challenge with global CLI commands is that `process.cwd()` is wherever the user runs the command, not where the code lives. This is solved by resolving the installation root from `import.meta.url`:

```typescript
const __filename = fileURLToPath(import.meta.url);
let installRoot = dirname(__filename);
while (!fs.existsSync(path.join(installRoot, 'package.json'))) {
    installRoot = path.dirname(installRoot);
}
```

---

## 12. Platform Engagement Normalization

### Decision
Apply platform-specific weights to engagement metrics before any cross-platform comparison.

### Rationale
Raw engagement metrics are incomparable across platforms:
- A Reddit post with 500 upvotes is highly viral
- A YouTube video with 500 views is essentially invisible
- A Hacker News post with 500 points is front-page material

The weights (`reddit: 1.0`, `youtube: 0.001`, `hackerNews: 1.0`) normalize these so that "high engagement" means roughly the same thing regardless of source.

Reddit's formula `score + (comments * 2)` additionally weights comments higher because a comment requires more effort than an upvote and indicates deeper audience engagement.

---

## 13. Structured LLM Outputs

### Decision
Use Gemini's `responseSchema` / `response_schema` feature to enforce JSON structure from LLM responses, rather than parsing free-text.

### Rationale
- **Guaranteed valid JSON** — The API will never return malformed JSON when a schema is provided.
- **Type safety** — Pydantic models on the Python side and TypeScript interfaces on the TS side validate the structure at compile time.
- **No regex parsing** — Earlier versions used regex to extract JSON from markdown-fenced responses. This was fragile and error-prone.

### Defensive Fallbacks
Despite schema enforcement, every LLM call site has a fallback path:
- Intent analysis falls back to `{ intent: "topic", confidence: 0.3 }`
- Signal extraction falls back to metadata-only signals
- Synthesis falls back to an empty trend catcher list with raw analysis attached
