import { readFileSync, writeFileSync } from "fs";
import { resolve } from "path";
import { SemanticSearchService } from "./semanticSearch.service.js";
import { GoogleEmbeddingClient } from "./embedding.client.js";
import { ExpansionScorer } from "./expansion.scorer.js";
import { ExpansionResult, Candidate } from "../intent/intent.types.js";

async function main() {
  // We use expansion-result.json as it already contains the parsed output from the trace
  const resultPath = resolve(process.cwd(), "output", "expansion-result.json");
  console.log(`Reading expansion results from ${resultPath}`);

  const rawData = JSON.parse(readFileSync(resultPath, "utf8"));

  const expansionResult: ExpansionResult = {
    seed: rawData.seed,
    intent: rawData.intent,
    candidates: rawData.candidates,
  };

  console.log(`Found ${expansionResult.candidates.length} candidates. Initializing Scorer...`);

  // Initialize dependencies
  const embeddingClient = new GoogleEmbeddingClient();
  const { LanceRepository } = await import("../storage/lance/lance.repository.js");
  const vectorStore = new LanceRepository();
  const semanticSearch = new SemanticSearchService(embeddingClient, vectorStore);
  const scorer = new ExpansionScorer(semanticSearch, embeddingClient);

  console.log("Running ExpansionScorer.score()...");
  console.log("This will generate embeddings, compute relative pairwise scores, index to DB, and compute global scores.\n");

  const startTime = Date.now();
  const scoredResult = await scorer.score(expansionResult);
  const duration = Date.now() - startTime;

  console.log(`Scoring complete in ${duration}ms.\n`);
  console.log("Top 15 Scored Candidates:");
  console.log("----------------------------------------------------------------------------------");
  console.log(
    "Rank | Score   | Global | Relative | Source       | Trend  | Query"
  );
  console.log("----------------------------------------------------------------------------------");

  scoredResult.candidates.slice(0, 15).forEach((c, index) => {
    const rank = (index + 1).toString().padEnd(4);
    const total = c.semanticScore?.toFixed(4).padEnd(7);
    const global = c.globalScore?.toFixed(4).padEnd(6);
    const relative = c.relativeScore?.toFixed(4).padEnd(8);
    const source = c.source.padEnd(12);
    const trend = (c.trendSignal || "-").padEnd(6);

    console.log(`${rank} | ${total} | ${global} | ${relative} | ${source} | ${trend} | ${c.query}`);
  });

  // Save the result
  const outPath = resolve(process.cwd(), "output", "expansion-scored.json");
  writeFileSync(outPath, JSON.stringify(scoredResult, null, 2));
  console.log(`\nFull detailed results saved to ${outPath}`);
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
