## Interface Specification

Version 0.1

---

# 1. Design Principles

Every module communicates only through interfaces.

Interfaces define capabilities.

Implementations remain private.

Every interface should represent a business capability rather than an implementation detail.

---

# 2. Pipeline Stage

Every stage inside the analysis pipeline follows the same contract.

```ts
interface PipelineStage {

    execute(
        context: AnalysisContext
    ): Promise<void>;

}
```

Responsibilities

- Receive context
    
- Enrich context
    
- Never replace context
    
- Never call later stages directly
    

---

# 3. Collector

Represents one external platform.

```ts
interface Collector {

    readonly source: Source;

    collect(
        queries: ExpandedQuery[]
    ): Promise<RawContent[]>;

}
```

Implementations

- YouTubeCollector
    
- RedditCollector
    
- GoogleCollector
    
- TikTokCollector
    

---

# 4. Normalizer

Transforms raw platform responses.

```ts
interface Normalizer {

    supports(
        source: Source
    ): boolean;

    normalize(
        raw: RawContent
    ): Promise<NormalizedContent>;

}
```

One implementation per platform.

---

# 5. Feature Extractor

Computes derived metrics.

```ts
interface FeatureExtractor {

    extract(
        content: NormalizedContent[]
    ): Promise<Feature[]>;

}
```

Feature extraction must never access external APIs.

---

# 6. Detection Engine

Common interface shared by Gap Engine and Trend Engine.

```ts
interface DetectionEngine<T> {

    detect(
        context: AnalysisContext
    ): Promise<T[]>;

}
```

Implementations

GapEngine

TrendEngine

---

# 7. Ranking Engine

Produces Opportunities.

```ts
interface RankingEngine {

    rank(
        context: AnalysisContext
    ): Promise<Opportunity[]>;

}
```

Ranking never modifies existing Gap or Trend objects.

---

# 8. LLM Provider

Represents any AI provider.

```ts
interface LLMProvider {

    summarize(
        context: AnalysisContext
    ): Promise<Summary>;

}
```

Possible implementations

OpenAI

Gemini

Claude

Local LLM

---

# 9. Repository

Persistent storage.

```ts
interface Repository<T> {

    save(entity: T): Promise<void>;

    update(entity: T): Promise<void>;

    find(id: string): Promise<T | null>;

    delete(id: string): Promise<void>;

}
```

Examples

TopicRepository

RunRepository

OpportunityRepository

---

# 10. Cache

Represents cache storage.

```ts
interface CacheProvider {

    get<T>(key: string): Promise<T | null>;

    set<T>(
        key: string,
        value: T,
        ttl?: number
    ): Promise<void>;

}
```

Redis becomes one implementation.

---

# 11. Queue

Represents background processing.

```ts
interface JobQueue {

    enqueue<T>(
        name: string,
        payload: T
    ): Promise<void>;

}
```

BullMQ becomes one implementation.

---

# 12. Exporter

Produces downloadable reports.

```ts
interface Exporter {

    export(
        run: AnalysisRun
    ): Promise<Buffer>;

}
```

Implementations

CSVExporter

PDFExporter

ExcelExporter

---

# 13. Logger

Infrastructure abstraction.

```ts
interface Logger {

    info(...)

    warn(...)

    error(...)

}
```

Implementation

Pino

---

# 14. Clock

Avoid direct Date.now() usage.

```ts
interface Clock {

    now(): Date;

}
```

Improves testing.

---

# 15. UUID Generator

```ts
interface IdGenerator {

    generate(): string;

}
```

Improves testing.

---

# 16. HTTP Client

Used by collectors.

```ts
interface HttpClient {

    get<T>()

    post<T>()

}
```

Implementation

undici

---

# 17. Scheduler

Future background refresh.

```ts
interface Scheduler {

    schedule(job);

}
```

BullMQ Cron implementation.

---

# 18. Dependency Rules

Business modules depend only on interfaces.

Infrastructure modules implement interfaces.

Business logic must never instantiate infrastructure directly.

Dependency flow

Business

↓

Interfaces

↓

Infrastructure

Never

Infrastructure

↓

Business


interface AnalysisContext {
    request: AnalysisRequest;

    topic?: Topic;

    queries: ExpandedQuery[];

    rawContent: RawContent[];

    normalizedContent: NormalizedContent[];

    features: Feature[];

    gaps: Gap[];

    trends: Trend[];

    opportunities: Opportunity[];

    metadata: AnalysisMetadata;
}