import { IntentAnalyzerLike } from "./intent.interface.js";
import { IntentAnalysis, Intent } from "./intent.types.js";
import { LLMCaller, LLMFactory, LLMMessage } from "../common/llm/llm.types.js";

const VALID_INTENTS: Intent[] = [
  "topic",
  "shopping",
  "news",
  "learning",
  "brand",
];

const SYSTEM_PROMPT = [
  "You classify a search query or domain descriptor for a content trend-and-gap analyzer.",
  "Follow this reasoning, then output the result:",
  "1. Is this a broad topic/domain, or something specific (a product, brand, event)?",
  "2. What is the primary intent behind it?",
  "   - topic: a broad subject to explore (e.g. 'AI', 'personal finance')",
  "   - shopping: comparison/purchase intent (signals: best, vs, review, cheap, alternatives)",
  "   - news: wants current/recent developments (signals: latest, today, release, announced)",
  "   - learning: wants to acquire a skill/understanding (signals: how to, guide, what is, beginner)",
  "   - brand: the query IS a specific named product/company/entity (e.g. 'Notion', 'Claude')",
  "3. What category/domain does it belong to (e.g. Technology, Finance, Health, Gaming, Marketing, General)?",
  "4. How confident are you in this classification (0-1)?",
].join("\n");

// Schema handed to Gemini so the response is guaranteed valid JSON with a
// valid intent enum — the defensive parse below becomes a safety net only.
const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    category: { type: "string" },
    intent: {
      type: "string",
      enum: ["topic", "shopping", "news", "learning", "brand"],
    },
    confidence: { type: "number" },
  },
  required: ["category", "intent", "confidence"],
};

// ── Topic extraction prompt & schema ───────────────────────────────────────

const TOPIC_SYSTEM_PROMPT = [
  "You are a topic extractor for a content trend analyzer.",
  "Given a user query, extract the core subject-matter topics from it.",
  "Strip away intent signals (how to, best, latest, what is, etc.) and return",
  "only the substantive topic phrases that could serve as independent search seeds.",
  "",
  "Rules:",
  "- Return concise, searchable topic phrases (2-4 words ideal).",
  "- Do NOT return the original query verbatim unless it is already a clean topic.",
  "- If the query IS already a clean topic (e.g. 'artificial intelligence'), return it as-is.",
  "- Order by relevance: most central topic first.",
  "- Each topic should be distinct — no near-duplicates.",
  "",
  "Examples:",
  "  'what is artificial intelligence' → ['artificial intelligence']",
  "  'best running shoes for flat feet' → ['running shoes', 'flat feet running']",
  "  'how to learn rust programming in 2024' → ['rust programming']",
  "  'apple vision pro vs meta quest 3' → ['apple vision pro', 'meta quest 3', 'mixed reality headsets']",
  "  'latest news on electric vehicles' → ['electric vehicles']",
  "  'AI coding tools' → ['AI coding tools']",
].join("\n");

function buildTopicSchema(maxTopics: number): Record<string, unknown> {
  return {
    type: "object",
    properties: {
      topics: {
        type: "array",
        items: { type: "string" },
        maxItems: maxTopics,
      },
    },
    required: ["topics"],
  };
}

// ── Analyzer ───────────────────────────────────────────────────────────────

export class LLMIntentAnalyzer implements IntentAnalyzerLike {
  private readonly llm: LLMCaller;
  private readonly maxTopics: number;

  constructor(factory: LLMFactory, maxTopics: number = 3) {
    this.llm = factory.get("intent");
    this.maxTopics = Math.max(1, Math.min(maxTopics, 10));
  }

  async analyze(query: string): Promise<IntentAnalysis> {
    // Run intent classification and topic extraction in parallel
    const [intentResult, topics] = await Promise.all([
      this.classifyIntent(query),
      this.extractTopics(query),
    ]);

    return {
      ...intentResult,
      topics,
    };
  }

  // ── Intent classification (unchanged logic) ─────────────────────────────

  private async classifyIntent(
    query: string,
  ): Promise<Omit<IntentAnalysis, "topics">> {
    const messages: LLMMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: `Query: "${query}"` },
    ];

    let raw: string;
    try {
      raw = await this.llm.complete(messages, {
        schema: RESPONSE_SCHEMA,
        temperature: 0,
        maxTokens: 4096,
      });
    } catch {
      return this.fallback(query);
    }

    const parsed = this.parseIntent(raw);
    if (!parsed) return this.fallback(query);

    return {
      originalQuery: query,
      category: parsed.category,
      intent: parsed.intent,
      confidence: parsed.confidence,
    };
  }

  // ── Topic extraction ────────────────────────────────────────────────────

  private async extractTopics(query: string): Promise<string[]> {
    const fallbackTopic = query.toLowerCase().replace(/\s+/g, " ").trim();

    const messages: LLMMessage[] = [
      { role: "system", content: TOPIC_SYSTEM_PROMPT },
      {
        role: "user",
        content:
          `Query: "${query}"\n` +
          `Extract up to ${this.maxTopics} core topics.`,
      },
    ];

    let raw: string;
    try {
      raw = await this.llm.complete(messages, {
        schema: buildTopicSchema(this.maxTopics),
        temperature: 0,
        maxTokens: 1024,
      });
    } catch {
      // If topic extraction fails, use the normalized original query
      return [fallbackTopic];
    }

    const topics = this.parseTopics(raw);

    // Never return empty — fall back to the normalized original query
    return topics.length > 0 ? topics : [fallbackTopic];
  }

  // ── Parsers ─────────────────────────────────────────────────────────────

  private parseIntent(
    raw: string,
  ): Omit<IntentAnalysis, "originalQuery" | "topics"> | undefined {
    // With responseSchema this is near-guaranteed valid JSON, but tolerate
    // any stray wrapping and validate every field defensively regardless.
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) return undefined;

    let obj: any;
    try {
      obj = JSON.parse(raw.slice(start, end + 1));
    } catch {
      return undefined;
    }

    const intent: Intent = VALID_INTENTS.includes(obj?.intent)
      ? obj.intent
      : "topic";

    const confidence =
      typeof obj?.confidence === "number"
        ? Math.max(0, Math.min(1, obj.confidence))
        : 0.5;

    const category =
      typeof obj?.category === "string" && obj.category.trim()
        ? obj.category.trim()
        : "General";

    return { category, intent, confidence };
  }

  private parseTopics(raw: string): string[] {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) return [];

    try {
      const obj = JSON.parse(raw.slice(start, end + 1));
      if (!Array.isArray(obj?.topics)) return [];

      const parsed = obj.topics
        .filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
        .map((t: string) => t.trim())
        .slice(0, this.maxTopics);

      return this.normalizeTopics(parsed);
    } catch {
      return [];
    }
  }

  /**
   * Normalize topics: lowercase, collapse whitespace, dedup by normalized form.
   * Keeps the first occurrence's original casing for display, but ensures no
   * near-duplicates slip through (e.g. "AI Coding Tools" vs "ai coding tools").
   */
  private normalizeTopics(topics: string[]): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const raw of topics) {
      const normalized = raw
        .toLowerCase()
        .replace(/\s+/g, " ")   // collapse internal whitespace
        .trim();

      if (normalized.length === 0) continue;
      if (seen.has(normalized)) continue;

      seen.add(normalized);
      result.push(normalized);
    }

    return result;
  }

  // ── Fallback ────────────────────────────────────────────────────────────

  private fallback(query: string): Omit<IntentAnalysis, "topics"> {
    // safe default so a bad LLM response or network error never breaks expansion;
    // confidence 0.3 signals to downstream code that the fallback fired
    return {
      originalQuery: query,
      category: "General",
      intent: "topic",
      confidence: 0.3,
    };
  }
}
