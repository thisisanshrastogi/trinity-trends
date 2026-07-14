export type Intent = "topic" | "shopping" | "news" | "learning" | "brand";

export interface IntentAnalysis {
  originalQuery: string;
  category: string;
  intent: Intent;
  /** Core subject-matter phrases distilled from the query — these become seeds for expansion. */
  topics: string[];
  confidence: number;
}

export type ExpansionSource =
  | "llm" // structure: enumerated subtopics
  | "autocomplete" // demand: what people type
  | "trends"; // demand: co-trending queries

export type CandidateKind = "structure" | "demand";

export interface ExpandedQuery {
  query: string;
  source: ExpansionSource;
  // Trends only: rising is the gap goldmine, top is saturated
  trendSignal?: "rising" | "top";
}

// What the expansion layer emits — flat, provenance-carrying.
export interface Candidate {
  query: string;
  source: ExpansionSource;
  kind: CandidateKind;
  trendSignal?: "rising" | "top";
  semanticScore?: number; // combined score
  relativeScore?: number; // similarity within the expansion batch across sources
  globalScore?: number; // similarity to the seed/db globally
}

export interface ExpansionResult {
  seed: string;
  intent: IntentAnalysis;
  candidates: Candidate[];
}
