import { SemanticSearchLike, EmbeddingClientLike } from "./semanticSearch.types.js";
import { ExpansionResult, Candidate } from "../intent/intent.types.js";

const RELATIVE_SIMILARITY_THRESHOLD = 0.85;
const GLOBAL_SIMILARITY_THRESHOLD = 0.95;
const DEMAND_BOOST = 0.05;
const RISING_BOOST = 0.15;
const TOP_BOOST = 0.05;
const GLOBAL_WEIGHT = 0.6;
const RELATIVE_WEIGHT = 0.4;
const MIN_GLOBAL_SCORE = 0.1;
const SEED_PENALTY = 0.15;

// Helper for Cosine Similarity
function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) return 0;
  let dotProduct = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class ExpansionScorer {
  constructor(
    private readonly semanticSearch: SemanticSearchLike,
    private readonly embeddingClient: EmbeddingClientLike
  ) { }

  /**
   * Scores candidates by calculating both a 'relative' score (cross-corroboration
   * among the candidates) and a 'global' score (similarity in the whole DB/seed).
   */
  async score(result: ExpansionResult): Promise<ExpansionResult> {
    const { seed, candidates } = result;
    if (!candidates.length) return result;

    // --- 1. Calculate Relative Score (In-batch similarity across sources) ---
    const textsToEmbed = candidates.map(c => c.query);
    const candidateEmbeddings = await this.embeddingClient.embed(textsToEmbed, false);

    // Compute pairwise similarity to reward cross-source semantic matches
    const relativeScores = new Array(candidates.length).fill(0);

    for (let i = 0; i < candidates.length; i++) {
      let crossSourceMatches = 0;

      for (let j = 0; j < candidates.length; j++) {
        if (i === j) continue;
        const sim = cosineSimilarity(candidateEmbeddings[i], candidateEmbeddings[j]);

        // If they are highly similar but come from different sources
        if (sim > RELATIVE_SIMILARITY_THRESHOLD && candidates[i].source !== candidates[j].source) {
          crossSourceMatches += sim;
        }
      }
      // Score based on how many distinct sources corroborated this semantic space
      relativeScores[i] = crossSourceMatches;
    }

    // Normalize relative scores to a 0-1 range
    const maxRel = Math.max(...relativeScores, 1); // prevent division by zero
    for (let i = 0; i < candidates.length; i++) {
      candidates[i].relativeScore = relativeScores[i] / maxRel;
    }

    // --- 2. Calculate Global Score (Similarity to DB / Seed) ---
    // Index candidates so they are in the DB and deduplicated globally.
    const topicsToIndex = candidates.map(c => ({
      text: c.query,
      metadata: {
        source: c.source,
        kind: c.kind,
        trendSignal: c.trendSignal
      }
    }));
    await this.semanticSearch.indexTopics(topicsToIndex);

    // Search the DB relative to the seed to get the global score
    const searchResults = await this.semanticSearch.searchTopics(seed, 50);

    const candidateQueryMap = new Map<string, Candidate>();
    for (const c of candidates) {
      candidateQueryMap.set(c.query.toLowerCase().trim(), c);
    }

    for (const res of searchResults) {
      const normText = res.document.text.toLowerCase().trim();
      const match = candidateQueryMap.get(normText);
      if (match) {
        match.globalScore = res.similarityScore;
      }
    }

    // --- 3. Combine Scores and Deduplicate ---
    const scoredCandidates: Candidate[] = [];
    const acceptedTexts = new Set<string>();

    for (const candidate of candidates) {
      const normText = candidate.query.toLowerCase().trim();

      // Since candidates might contain exact string duplicates from different sources,
      // we take the first one (we already accumulated their cross-source validation in relativeScore)
      if (acceptedTexts.has(normText)) continue;

      const global = candidate.globalScore || MIN_GLOBAL_SCORE;
      const relative = candidate.relativeScore || 0;

      // Combine: 60% global (how relevant is it to the seed generally), 40% relative (how corroborated is it)
      let semanticScore = (global * GLOBAL_WEIGHT) + (relative * RELATIVE_WEIGHT);

      // Heuristic boosts based on structural properties
      if (candidate.trendSignal === "rising") semanticScore += RISING_BOOST;
      if (candidate.trendSignal === "top") semanticScore += TOP_BOOST;
      if (candidate.kind === "demand") semanticScore += DEMAND_BOOST;

      // Penalize candidates that are practically identical to the seed
      if (global > GLOBAL_SIMILARITY_THRESHOLD) {
        semanticScore -= SEED_PENALTY;
      }

      candidate.semanticScore = Number(semanticScore.toFixed(4));
      candidate.globalScore = Number(global.toFixed(4));
      candidate.relativeScore = Number(relative.toFixed(4));

      scoredCandidates.push(candidate);
      acceptedTexts.add(normText);
    }

    // 4. Sort descending by the combined semantic score
    scoredCandidates.sort((a, b) => (b.semanticScore ?? 0) - (a.semanticScore ?? 0));

    return { ...result, candidates: scoredCandidates };
  }
}
