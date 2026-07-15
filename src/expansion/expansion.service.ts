import {
  IntentAnalyzerLike,
  QueryExpander,
} from "../intent/intent.interface.js";
import {
  Candidate,
  CandidateKind,
  ExpandedQuery,
  ExpansionResult,
  ExpansionSource,
  IntentAnalysis,
} from "../intent/intent.types.js";

// Which kind of signal each source contributes.
const KIND_OF: Record<ExpansionSource, CandidateKind> = {
  llm: "structure",
  autocomplete: "demand",
  trends: "demand",
};

export class ExpansionService {
  constructor(
    private readonly expanders: QueryExpander[],
  ) {}

  async expand(seed: string, intent: IntentAnalysis): Promise<ExpansionResult> {
    const topics = intent.topics;

    // Expand every topic with every expander in parallel.
    // Each topic × expander pair is independent; a single failure yields []
    // rather than sinking the batch.
    const topicResults = await Promise.all(
      topics.map((topic) => this.expandTopic(topic, intent)),
    );

    // Flatten and dedup across topics — same query from two topics is kept once.
    const seen = new Set<string>();
    const candidates: Candidate[] = [];

    for (const expanded of topicResults.flat()) {
      const key = expanded.query.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);

      candidates.push({
        query: expanded.query,
        source: expanded.source,
        kind: KIND_OF[expanded.source],
        trendSignal: expanded.trendSignal,
      });
    }

    return { seed, intent, candidates };
  }

  /**
   * Run all expanders for a single topic.
   * The full IntentAnalysis is forwarded so expanders (especially the LLM
   * subtopic expander) can leverage category, intent, and sibling topic
   * context from the original query — even though the seed they expand is
   * a distilled topic phrase.
   */
  private async expandTopic(
    topic: string,
    intent: IntentAnalysis,
  ): Promise<ExpandedQuery[]> {
    const settled = await Promise.allSettled(
      this.expanders.map((e) => e.expand(topic, intent)),
    );

    return settled.flatMap((r) =>
      r.status === "fulfilled" ? r.value : [],
    );
  }
}
