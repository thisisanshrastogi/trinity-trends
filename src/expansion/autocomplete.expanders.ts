import type { AxiosInstance } from "axios";
import { createHttpClient } from "../common/http/client.js";
import { QueryExpander } from "../intent/intent.interface.js";
import { ExpandedQuery, IntentAnalysis } from "../intent/intent.types.js";
import { traced, Tracer } from "../common/llm/llm.trace.js";

export class GoogleAutocompleteExpander implements QueryExpander {
  readonly source = "autocomplete";
  private readonly httpClient: AxiosInstance;
  private readonly depth: number;

  constructor(
    private readonly tracer?: Tracer,
    depth: number = 1,
  ) {
    this.depth = Math.min(Math.max(depth, 1), 3);
    this.httpClient = createHttpClient({
      baseURL: "https://suggestqueries.google.com",
      timeoutMs: 8000,
    });
  }

  async expand(
    query: string,
    _intent: IntentAnalysis,
  ): Promise<ExpandedQuery[]> {
    return this.expandRecursive(query, 1, new Set<string>());
  }

  private async fetchAutocomplete(query: string): Promise<string[]> {
    try {
      const res = await traced(
        this.tracer,
        "autocomplete",
        () =>
          this.httpClient.get("/complete/search", {
            params: { client: "firefox", q: query },
          }),
        (r) => ({ status: r.status, suggestions: (r.data?.[1] ?? []).length }),
        (r) => r.data, // full [query, [suggestions], ...] payload to file
      );
      const suggestions: string[] = Array.isArray(res.data?.[1])
        ? res.data[1]
        : [];
      return suggestions.filter(
        (s) => s && s.toLowerCase() !== query.toLowerCase(),
      );
    } catch (err) {
      this.tracer?.event({
        scope: "autocomplete",
        phase: "error",
        detail: err instanceof Error ? err.message : err,
      });
      return [];
    }
  }

  private async expandRecursive(
    query: string,
    currentDepth: number,
    seen: Set<string>,
  ): Promise<ExpandedQuery[]> {
    if (currentDepth > this.depth) {
      return [];
    }

    const suggestions = await this.fetchAutocomplete(query);

    const validSuggestions = suggestions.filter((s) => {
      const lower = s.toLowerCase();
      if (seen.has(lower)) {
        return false;
      }
      return true;
    });

    const results: ExpandedQuery[] = validSuggestions.map((s) => ({
      query: s,
      source: this.source,
    }));

    for (const s of validSuggestions) {
      seen.add(s.toLowerCase());
    }

    if (currentDepth < this.depth) {
      const nestedPromises = validSuggestions.map((s) =>
        this.expandRecursive(s, currentDepth + 1, seen),
      );
      const nestedResults = await Promise.all(nestedPromises);
      results.push(...nestedResults.flat());
    }

    return results;
  }
}
