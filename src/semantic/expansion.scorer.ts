import { SemanticSearchLike, EmbeddingClientLike } from "./semanticSearch.types.js";
import { ExpansionResult, Candidate } from "../intent/intent.types.js";

const RELATIVE_SIMILARITY_THRESHOLD = 0.6;   // short-string bi-encoder paraphrases rarely exceed ~0.8
const GLOBAL_WEIGHT = 0.8;
const RELATIVE_WEIGHT = 0.2;
const SEMANTIC_DEDUP_THRESHOLD = 0.88;

// Multiplicative boosts: scale WITH relevance instead of adding a flat slab.
// A flat +0.15 pins every high-relevance candidate to 1.0 and destroys ranking
// at the top; a 1.06x multiplier nudges proportionally and never saturates a
// mid-tier candidate above a high-tier one.
const RISING_MULT = 1.06;   // trend signal is a weak tiebreaker, not a ranking driver
const TOP_MULT = 1.03;
const DEMAND_MULT = 1.02;

function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

export class ExpansionScorer {
  constructor(
    private readonly semanticSearch: SemanticSearchLike,
    private readonly embeddingClient: EmbeddingClientLike
  ) { }

  async score(result: ExpansionResult): Promise<ExpansionResult> {
    const { seed, candidates } = result;
    if (!candidates.length) return result;

    const n = candidates.length;

    // --- 1. Embed candidates as documents, seed as a query ---
    const candidateEmbeddings = await this.embeddingClient.embed(
      candidates.map((c) => c.query),
      false
    );
    const [seedEmbedding] = await this.embeddingClient.embed([seed], true);

    // Fail loudly. Without a seed embedding every global score collapses to the
    // same floor and the whole ranking is silently meaningless.
    if (!seedEmbedding) {
      throw new Error(`ExpansionScorer: failed to embed seed "${seed}"`);
    }
    if (candidateEmbeddings.length !== n) {
      throw new Error(
        `ExpansionScorer: embedding count ${candidateEmbeddings.length} != candidate count ${n}`
      );
    }

    // --- 2. Pairwise similarity matrix (computed once, reused by 3 and 6) ---
    const sim: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const s = cosineSimilarity(candidateEmbeddings[i], candidateEmbeddings[j]);
        sim[i][j] = s;
        sim[j][i] = s;
      }
    }

    // --- 3. Global score: direct seed similarity for EVERY candidate ---
    const globalScores = candidateEmbeddings.map((emb) =>
      clamp01(cosineSimilarity(emb, seedEmbedding))
    );

    // --- 4. Relative score: cross-source corroboration ---
    // Mean over matching peers, not a sum: a sum rewards phrase families that
    // happen to have many near-variants ("hidden fees X" x9) rather than
    // measuring whether a candidate is actually corroborated.
    const relativeRaw = new Array<number>(n).fill(0);
    const hasCrossSourcePeer = new Array<boolean>(n).fill(false);

    for (let i = 0; i < n; i++) {
      let sum = 0;
      let matches = 0;
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        if (candidates[i].source === candidates[j].source) continue;
        hasCrossSourcePeer[i] = true;
        if (sim[i][j] > RELATIVE_SIMILARITY_THRESHOLD) {
          sum += sim[i][j];
          matches++;
        }
      }
      relativeRaw[i] = matches > 0 ? sum / matches : 0;
    }

    const maxRel = Math.max(...relativeRaw, Number.EPSILON);
    const relativeScores = relativeRaw.map((r) => r / maxRel);

    // --- 5. Combine + exact dedup ---
    const scored: Array<{ candidate: Candidate; embIndex: number }> = [];
    const accepted = new Set<string>();

    for (let i = 0; i < n; i++) {
      const candidate = candidates[i];
      const normText = candidate.query.toLowerCase().trim();
      if (accepted.has(normText)) continue;

      const global = globalScores[i] ?? 0;
      const relative = relativeScores[i] ?? 0;

      // No cross-source peer -> corroboration is undefined, not zero.
      // Fall back to pure relevance instead of zeroing 20% of the score.
      const base = hasCrossSourcePeer[i]
        ? global * GLOBAL_WEIGHT + relative * RELATIVE_WEIGHT
        : global;

      let boost = 1;
      if (candidate.trendSignal === "rising") boost *= RISING_MULT;
      else if (candidate.trendSignal === "top") boost *= TOP_MULT;
      if (candidate.kind === "demand") boost *= DEMAND_MULT;

      // Clamp the boost's headroom rather than the product: keeps two
      // high-scoring candidates from both saturating to a 1.0 tie.
      const rank = clamp01(base) * boost > 1
        ? clamp01(base) + (1 - clamp01(base)) * (boost - 1)
        : clamp01(base) * boost;

      const enriched: Candidate = {
        ...candidate,
        semanticScore: Number(clamp01(rank).toFixed(4)),
        globalScore: Number(global.toFixed(4)),
        relativeScore: Number(relative.toFixed(4)),
      };

      scored.push({ candidate: enriched, embIndex: i });
      accepted.add(normText);
    }

    // --- 6. Sort by score, then greedily drop near-duplicates ---
    // Sort must precede dedup: greedy selection keeps whichever cluster member
    // it sees first, so seeing them best-first makes the survivor the best one.
    scored.sort(
      (a, b) => (b.candidate.semanticScore ?? 0) - (a.candidate.semanticScore ?? 0)
    );

    const diverse: Candidate[] = [];
    const keptIndices: number[] = [];

    for (const { candidate, embIndex } of scored) {
      const isDuplicate = keptIndices.some(
        (kept) => sim[embIndex][kept] > SEMANTIC_DEDUP_THRESHOLD
      );
      if (isDuplicate) continue;

      diverse.push(candidate);
      keptIndices.push(embIndex);
    }

    // --- 7. Index (side effect only; nothing downstream reads this today) ---
    await this.semanticSearch.indexTopics(
      candidates.map((c) => ({
        text: c.query,
        metadata: { source: c.source, kind: c.kind, trendSignal: c.trendSignal },
      }))
    );

    return { ...result, candidates: diverse };
  }
}