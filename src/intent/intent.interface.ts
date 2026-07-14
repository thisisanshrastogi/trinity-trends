import { IntentAnalysis, ExpandedQuery } from "./intent.types.js";

export interface IntentAnalyzerLike {
  analyze(query: string): Promise<IntentAnalysis>;
}

export interface QueryExpander {
  readonly source: string;
  expand(query: string, intent: IntentAnalysis): Promise<ExpandedQuery[]>;
}
