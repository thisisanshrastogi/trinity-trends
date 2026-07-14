import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { LLMIntentAnalyzer } from "./intent.analyzer.js";
import { GeminiFactory } from "../common/llm/gemini.factory.js";
import { ConsoleTracer, TraceEvent, Tracer } from "../common/llm/llm.trace.js";

const OUTPUT_DIR = "output";

async function saveJson(filePath: string, value: unknown) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function buildRecordingTracer(): { tracer: Tracer; events: TraceEvent[] } {
  const console = new ConsoleTracer(true);
  const events: TraceEvent[] = [];
  const tracer: Tracer = {
    event(e: TraceEvent) {
      events.push({ ...e, at: new Date().toISOString() } as TraceEvent & {
        at: string;
      });
      console.event(e);
    },
  };
  return { tracer, events };
}

test("intent analyzer classifies queries and extracts topics", async () => {
  const { tracer, events } = buildRecordingTracer();
  const factory = new GeminiFactory({ tracer });
  const analyzer = new LLMIntentAnalyzer(factory, 3); // maxTopics = 3

  const testQueries = [
    "what is artificial intelligence",                  // learning → topic: "artificial intelligence"
    "best running shoes for flat feet",                 // shopping → topics: "running shoes", "flat feet running"
    "apple vision pro vs meta quest 3",                 // shopping/brand → multiple topics
    "how to learn rust programming in 2024",            // learning → topic: "rust programming"
    "latest news on electric vehicles",                 // news → topic: "electric vehicles"
    "Sony PlayStation 5",                               // brand → topic as-is
    "sustainable agriculture practices",                // topic → topic as-is
    "AI coding tools",                                  // topic → topic as-is
  ];

  const results = [];

  console.log("\n========================================");
  console.log("  Intent Analyzer + Topic Extraction Test");
  console.log("========================================\n");

  for (const query of testQueries) {
    console.log(`\n─── Query: "${query}" ───`);
    const result = await analyzer.analyze(query);

    // Basic assertions
    assert.ok(result, "expected a result");
    assert.equal(result.originalQuery, query);
    assert.ok(
      ["topic", "shopping", "news", "learning", "brand"].includes(result.intent),
      `intent "${result.intent}" should be a valid enum value`,
    );
    assert.ok(
      result.confidence >= 0 && result.confidence <= 1,
      "confidence should be within 0-1",
    );
    assert.ok(
      Array.isArray(result.topics) && result.topics.length > 0,
      "should extract at least one topic",
    );

    // Pretty-print
    console.log(`  Intent:     ${result.intent}`);
    console.log(`  Category:   ${result.category}`);
    console.log(`  Topics:     ${result.topics.join(" | ")}`);
    console.log(`  Confidence: ${result.confidence}`);

    results.push(result);
  }

  await saveJson(path.join(OUTPUT_DIR, "intent-result.json"), results);
  await saveJson(path.join(OUTPUT_DIR, "intent-trace.json"), events);

  // Summary table
  console.log("\n\n========== Summary ==========\n");
  console.log(
    "Query".padEnd(48) +
      "Intent".padEnd(12) +
      "Topics",
  );
  console.log("─".repeat(90));
  for (const r of results) {
    const q =
      r.originalQuery.length > 45
        ? r.originalQuery.slice(0, 42) + "..."
        : r.originalQuery;
    console.log(
      q.padEnd(48) +
        r.intent.padEnd(12) +
        r.topics.join(" | "),
    );
  }

  console.log(`\nOutput  -> ${path.join(OUTPUT_DIR, "intent-result.json")}`);
  console.log(`Trace   -> ${path.join(OUTPUT_DIR, "intent-trace.json")}`);
});
