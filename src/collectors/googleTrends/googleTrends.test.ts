import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { GoogleTrendsCollector } from "./googleTrends.collector.js";
import { GoogleTrendsClient } from "./googleTrends.client.js";
import {
  GoogleTrendsMethod,
  GoogleTrendsMethodResult,
} from "./googleTrends.types.js";

const OUTPUT_DIR = "output";
const QUERY = "bitcoin";
const GEO = "US";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function saveJson(filePath: string, value: unknown) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

function byMethod(
  results: GoogleTrendsMethodResult[],
  method: GoogleTrendsMethod,
): GoogleTrendsMethodResult {
  const found = results.find((r) => r.method === method);
  assert.ok(found, `expected a result for method "${method}"`);
  return found;
}

test("google trends collect hits the live API across multiple methods", async () => {
  const collector = new GoogleTrendsCollector();

  const methods: GoogleTrendsMethod[] = [
    "interestOverTime",
    "interestByRegion",
    "relatedQueries",
    "relatedTopics",
  ];

  let results: GoogleTrendsMethodResult[];
  try {
    results = await collector.collect({
      query: QUERY,
      methods,
      geo: GEO,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Rate limit")) {
      console.log("  note: Test aborted early due to propagated Rate Limit error");
      return;
    }
    throw err;
  }

  assert.equal(collector.id, "googleTrends");

  // one result per requested method, in order, no dropped methods
  assert.equal(results.length, methods.length);
  assert.deepEqual(
    results.map((r) => r.method),
    methods,
    "collect() should return one result per method, preserving order",
  );

  // core methods must return data
  for (const m of ["interestOverTime", "interestByRegion"] as const) {
    const r = byMethod(results, m);
    assert.ok(!r.error, `${m} should not error, got: ${r.error}`);
  }

  // interestOverTime — timeline present with numeric values
  const iot = byMethod(results, "interestOverTime").interestOverTime;
  assert.ok(iot, "interestOverTime payload should be present");
  assert.ok(
    iot.timelineData.length > 0,
    "expected interestOverTime to return timeline points",
  );
  assert.ok(
    iot.timelineData.some(
      (p) => p.value.length > 0 && typeof p.value[0] === "number",
    ),
    "timeline points should carry numeric values",
  );

  // interestByRegion — at least one region with a name
  const ibr = byMethod(results, "interestByRegion").interestByRegion;
  assert.ok(ibr, "interestByRegion payload should be present");
  assert.ok(
    ibr.length > 0 && ibr[0].geoName.length > 0,
    "expected interestByRegion to return named regions",
  );

  // related-* may be rate-limited; require a clean result OR a clean error,
  // never a throw. A surviving 429 is tolerated and logged.
  for (const m of ["relatedQueries", "relatedTopics"] as const) {
    const r = byMethod(results, m);
    const ok =
      r.error !== undefined ||
      (r[m] !== undefined &&
        Array.isArray(r[m]!.top) &&
        Array.isArray(r[m]!.rising));
    assert.ok(ok, `${m} should parse cleanly`);
  }

  const file = path.join(OUTPUT_DIR, "googleTrends-collect.json");
  await saveJson(file, results);

  const rq = byMethod(results, "relatedQueries").relatedQueries;
  const rt = byMethod(results, "relatedTopics").relatedTopics;

  console.log();
  console.log(`Ran ${results.length} methods for "${QUERY}" (${GEO})`);
  console.log(`interestOverTime points -> ${iot.timelineData.length}`);
  console.log(`interestByRegion regions -> ${ibr.length}`);
  console.log(
    `relatedQueries -> ${
      rq ? `top ${rq.top.length}, rising ${rq.rising.length}` : "(rate limited)"
    }`,
  );
  console.log(
    `relatedTopics -> ${
      rt ? `top ${rt.top.length}, rising ${rt.rising.length}` : "(rate limited)"
    }`,
  );
  console.log(`Output -> ${file}`);

  await sleep(1500);
});

test("google trends collect isolates a bad method without failing the batch", async () => {
  const collector = new GoogleTrendsCollector();

  // autoComplete uses only keyword[0], so this also exercises the
  // single-keyword path alongside a healthy data method.
  let results: GoogleTrendsMethodResult[];
  try {
    results = await collector.collect({
      query: QUERY,
      methods: ["autoComplete", "interestOverTime"],
      geo: GEO,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Rate limit")) {
      console.log("  note: Test aborted early due to propagated Rate Limit error");
      return;
    }
    throw err;
  }

  assert.equal(results.length, 2);

  const ac = byMethod(results, "autoComplete");
  // autoComplete should resolve to a result — items or a clean error — never throw
  assert.ok(
    ac.autoComplete !== undefined || ac.error !== undefined,
    "autoComplete should resolve to a result, not throw",
  );

  const iot = byMethod(results, "interestOverTime");
  assert.ok(
    iot.interestOverTime !== undefined || iot.error !== undefined,
    "interestOverTime should resolve cleanly alongside others",
  );

  const file = path.join(OUTPUT_DIR, "googleTrends-isolation.json");
  await saveJson(file, results);

  console.log();
  console.log(
    `autoComplete -> ${ac.autoComplete?.length ?? `error: ${ac.error}`}`,
  );
  console.log(`Output -> ${file}`);

  await sleep(1500);
});

test("google trends collect defaults keyword from query", async () => {
  const collector = new GoogleTrendsCollector();

  let results: GoogleTrendsMethodResult[];
  try {
    results = await collector.collect({
      query: QUERY,
      methods: ["interestOverTime"],
      geo: GEO,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes("Rate limit")) {
      console.log("  note: Test aborted early due to propagated Rate Limit error");
      return;
    }
    throw err;
  }

  const iot = byMethod(results, "interestOverTime").interestOverTime;
  assert.ok(iot, "query should have been promoted to keyword[0]");
  assert.ok(iot.timelineData.length > 0);

  await sleep(1500);
});

// --- Debug helpers (run with --test-name-pattern="DEBUG") ---

test("DEBUG raw interestOverTime payload", async () => {
  const client = new GoogleTrendsClient();
  const raw = await client.search({
    method: "interestOverTime",
    keyword: ["bitcoin"],
    geo: "US",
  });
  console.log("LEN:", raw.length);
  console.log("RAW (first 300):", JSON.stringify(raw.slice(0, 300)));
});

test("DEBUG relatedQueries raw", async () => {
  const client = new GoogleTrendsClient();
  const raw = await client.search({
    method: "relatedQueries",
    keyword: ["bitcoin"],
    geo: "US",
  });
  console.log("LEN:", raw.length);
  console.log("RAW (first 300):", JSON.stringify(raw.slice(0, 300)));
});
