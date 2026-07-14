import { Tracer } from "../common/llm/llm.trace.js";
import { LLMCaller, LLMFactory, LLMMessage } from "../common/llm/llm.types.js";
import { QueryExpander } from "../intent/intent.interface.js";
import { IntentAnalysis, ExpandedQuery } from "../intent/intent.types.js";

const SYSTEM_PROMPT = [
  "You map a domain into its constituent subtopics for a content gap analyzer.",
  "Enumerate the DISTINCT subtopics that make up the space — technologies,",
  "products, sub-domains, protocols, communities, and emerging terms a domain",
  "expert would list to cover it completely. Favor breadth: include nascent and",
  "niche subtopics, not just popular ones. Do NOT return generic related searches.",
  "do a websearch to find latest and relevant ones.",
  "Return 10-15 items.",
].join(" ");

const RESPONSE_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    subtopics: { type: "array", items: { type: "string" } },
  },
  required: ["subtopics"],
};

export class LLMSubtopicExpander implements QueryExpander {
  readonly source = "llm";
  private readonly llm: LLMCaller;

  constructor(
    factory: LLMFactory,
    private readonly tracer?: Tracer,
  ) {
    this.llm = factory.get("expansion");
  }

  async expand(
    query: string,
    intent: IntentAnalysis,
  ): Promise<ExpandedQuery[]> {
    // Build a context-rich prompt: the query is a distilled topic, but
    // category/intent/sibling topics come from the original query analysis.
    const contextLines = [
      `Domain: "${query}"`,
      `Intent: ${intent.intent}; Category: ${intent.category}`,
    ];
    // Pass sibling topics (other topics from the same query) for context
    const siblings = intent.topics.filter(
      (t) => t.toLowerCase() !== query.toLowerCase(),
    );
    if (siblings.length > 0) {
      contextLines.push(`Related topics: ${siblings.join(", ")}`);
    }

    const messages: LLMMessage[] = [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: contextLines.join("\n") },
    ];

    let raw: string;
    try {
      // the Gemini caller already traces the underlying call (scope gemini:expansion);
      // here we only need to surface expander-level outcomes.
      raw = await this.llm.complete(messages, {
        schema: RESPONSE_SCHEMA,
        temperature: 0.4,
        maxTokens: 2048,
      });
    } catch (err) {
      this.tracer?.event({
        scope: "llm:expansion",
        phase: "error",
        detail: err instanceof Error ? err.message : err,
      });
      return [];
    }

    const subtopics = this.parse(raw);

    this.tracer?.event({
      scope: "llm:expansion",
      phase: subtopics.length > 0 ? "ok" : "error",
      detail:
        subtopics.length > 0
          ? { subtopics: subtopics.length }
          : { note: "0 subtopics parsed", rawChars: raw.length },
    });

    return subtopics
      .filter((s) => s && s.toLowerCase() !== query.toLowerCase())
      .map((s) => ({ query: s, source: this.source }));
  }

  private parse(raw: string): string[] {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    if (start === -1 || end === -1 || end < start) return [];
    try {
      const obj = JSON.parse(raw.slice(start, end + 1));
      return Array.isArray(obj?.subtopics)
        ? obj.subtopics.filter(
            (s: unknown): s is string => typeof s === "string",
          )
        : [];
    } catch {
      return [];
    }
  }
}
