import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { GoogleTrendsCollector as GoogleTrendsCollectorFallback } from "../collectors/googleTrends/googleTrends.collector.js";
import { ConsoleTracer, TraceEvent, Tracer } from "../common/llm/llm.trace.js";
import { ExpansionService } from "./expansion.service.js";
import { GeminiFactory } from "../common/llm/gemini.factory.js";
import { LLMIntentAnalyzer } from "../intent/intent.analyzer.js";
import { ExpansionResult } from "../intent/intent.types.js";
import { GoogleAutocompleteExpander } from "./autocomplete.expanders.js";
import { LLMSubtopicExpander } from "./llm.subtopic.expanders.js";
import { TrendsExpander } from "./trends.expanders.js";

const OUTPUT_DIR = "output";
const SEED = "AI coding tools";

async function saveJson(filePath: string, value: unknown) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

// Tracer that both prints (via ConsoleTracer) and records events for the file.
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

function buildService(tracer: Tracer): ExpansionService {
  const factory = new GeminiFactory({ tracer }); // tracer flows to Gemini callers
  return new ExpansionService(new LLMIntentAnalyzer(factory), [
    new LLMSubtopicExpander(factory, tracer),
    new GoogleAutocompleteExpander(tracer, 1),
    new TrendsExpander(new GoogleTrendsCollectorFallback(), "US", tracer),
  ]);
}

// Small helper so we don't have to import the collector just for the default;
// if you prefer, import GoogleTrendsCollector directly and pass `new GoogleTrendsCollector()`.

function summarise(result: ExpansionResult) {
  const bySource = new Map<string, number>();
  const byKind = new Map<string, number>();
  let rising = 0;

  for (const c of result.candidates) {
    bySource.set(c.source, (bySource.get(c.source) ?? 0) + 1);
    byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
    if (c.trendSignal === "rising") rising++;
  }

  return {
    total: result.candidates.length,
    bySource: Object.fromEntries(bySource),
    byKind: Object.fromEntries(byKind),
    rising,
  };
}

test("expansion pipeline runs end-to-end and produces candidates", async () => {
  const { tracer, events } = buildRecordingTracer();
  const service = buildService(tracer);

  console.log(`\n=== Running expansion for "${SEED}" ===\n`);
  const result = await service.expand(SEED);

  // --- intent ---
  assert.equal(result.seed, SEED);
  assert.ok(result.intent, "expected an intent analysis");
  assert.ok(
    ["topic", "shopping", "news", "learning", "brand"].includes(
      result.intent.intent,
    ),
    "intent should be one of the valid enum values",
  );
  assert.ok(
    result.intent.confidence >= 0 && result.intent.confidence <= 1,
    "confidence should be within 0-1",
  );

  // --- candidates ---
  assert.ok(
    result.candidates.length > 0,
    "expected the pipeline to produce at least one candidate",
  );

  for (const c of result.candidates) {
    assert.ok(c.source, `"${c.query}" should carry source`);
    assert.ok(c.kind, `"${c.query}" should carry kind`);
  }

  const summary = summarise(result);

  await saveJson(path.join(OUTPUT_DIR, "expansion-result.json"), result);
  await saveJson(path.join(OUTPUT_DIR, "expansion-trace.json"), events);

  // --- report ---
  console.log();
  console.log(`Seed        -> "${SEED}"`);
  console.log(
    `Intent      -> ${result.intent.intent} (${result.intent.category}, conf ${result.intent.confidence})`,
  );
  if (result.intent.confidence <= 0.3) {
    console.log("  note: low confidence — intent fallback likely fired");
  }
  console.log(
    `Topics      -> ${result.intent.topics.join(" | ")}`,
  );
  console.log(`Candidates  -> ${summary.total}`);
  console.log(`  by source -> ${JSON.stringify(summary.bySource)}`);
  console.log(`  by kind   -> ${JSON.stringify(summary.byKind)}`);
  console.log(`  rising    -> ${summary.rising}`);
  if (!summary.byKind["structure"]) {
    console.log(
      "  warn: no structure candidates — LLM expander failed (see [gemini:expansion] / [llm:expansion] errors above)",
    );
  }

  console.log("\nTop 15 candidates:");
  for (const c of result.candidates.slice(0, 15)) {
    const signal = c.trendSignal ? ` [${c.trendSignal}]` : "";
    console.log(
      `  ${c.query}${signal}  (${c.source})`,
    );
  }

  console.log(`\nOutput  -> ${path.join(OUTPUT_DIR, "expansion-result.json")}`);
  console.log(`Trace   -> ${path.join(OUTPUT_DIR, "expansion-trace.json")}`);
});
