import { GoogleTrendsCollector } from "../collectors/googleTrends/googleTrends.collector.js";
import { Tracer, traced } from "../common/llm/llm.trace.js";
import { QueryExpander } from "../intent/intent.interface.js";
import { IntentAnalysis, ExpandedQuery } from "../intent/intent.types.js";

export class TrendsExpander implements QueryExpander {
  readonly source = "trends";

  constructor(
    private readonly collector = new GoogleTrendsCollector(),
    private readonly geo = "US",
    private readonly tracer?: Tracer,
  ) {}

  async expand(
    query: string,
    _intent: IntentAnalysis,
  ): Promise<ExpandedQuery[]> {
    try {
      const results = await traced(
        this.tracer,
        "trends",
        () =>
          this.collector.collect({
            query,
            methods: ["relatedQueries"],
            geo: this.geo,
          }),
        (r) => {
          const rq = r.find((x) => x.method === "relatedQueries");
          return {
            error: rq?.error,
            top: rq?.relatedQueries?.top.length ?? 0,
            rising: rq?.relatedQueries?.rising.length ?? 0,
          };
        },
        (r) => r, // full collector result to file
      );

      const rq = results.find(
        (r) => r.method === "relatedQueries",
      )?.relatedQueries;
      if (!rq) {
        this.tracer?.event({
          scope: "trends",
          phase: "error",
          detail: "no relatedQueries in result (possibly rate limited)",
        });
        return [];
      }

      const map = (
        list: typeof rq.top,
        signal: "rising" | "top",
      ): ExpandedQuery[] =>
        list
          .map((k) => k.query)
          .filter(
            (q): q is string => !!q && q.toLowerCase() !== query.toLowerCase(),
          )
          .map((q) => ({ query: q, source: this.source, trendSignal: signal }));

      // rising first — the gap goldmine
      return [...map(rq.rising, "rising"), ...map(rq.top, "top")];
    } catch (err) {
      this.tracer?.event({
        scope: "trends",
        phase: "error",
        detail: err instanceof Error ? err.message : err,
      });
      return [];
    }
  }
}

