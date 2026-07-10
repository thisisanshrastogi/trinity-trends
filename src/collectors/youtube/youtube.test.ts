// youtube.integration.test.ts

import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { YouTubeCollector } from "./youtube.collector.js";
import type { FilterSelection } from "./youtube.filters.js";

const OUTPUT_DIR = "output";
const QUERY = "finance";
const FILTERS: FilterSelection[] = [
  { category: "type", label: "Video" },
  { category: "uploadDate", label: "This month" },
];

async function saveJson(filePath: string, value: unknown) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("youtube search hits the live site and parses a page", async () => {
  const collector = new YouTubeCollector();
  const page = await collector.search({
    query: QUERY,
    filters: FILTERS,
  });

  assert.ok(
    page.videos.length > 0,
    "expected YouTube to return at least one video",
  );
  assert.equal(typeof page.hasMore, "boolean");
  assert.ok(page.videos[0].title.length > 0);
  assert.ok(page.videos[0].id.length > 0);
  assert.ok(page.videos[0].url.startsWith("https://www.youtube.com/watch?v="));

  const file = path.join(OUTPUT_DIR, "youtube-search.json");
  await saveJson(file, page);

  console.log();
  console.log(`Saved ${page.videos.length} search videos`);
  console.log(`Next cursor: ${page.continuation ? "(present)" : "(none)"}`);
  console.log(`Output -> ${file}`);
});

test("youtube collect hits the live site and respects the limit", async () => {
  const collector = new YouTubeCollector();
  const limit = 50;

  const videos = await collector.collect({
    query: QUERY,
    filters: FILTERS,
    limit,
  });

  assert.equal(
    videos.length,
    limit,
    "collect() should keep fetching pages until the requested limit is met",
  );

  const uniqueIds = new Set(videos.map((video) => video.id));
  assert.equal(
    uniqueIds.size,
    videos.length,
    "collect() should not duplicate videos",
  );

  assert.deepEqual(
    videos.map((video) => video.rank),
    videos.map((_, index) => index + 1),
    "collect() should assign a global rank across pages",
  );

  assert.ok(videos[0].title.length > 0);

  const file = path.join(OUTPUT_DIR, "youtube-collect.json");
  await saveJson(file, videos);

  console.log();
  console.log(`Saved ${videos.length} collected videos`);
  console.log(`Limit -> ${limit}`);
  console.log(`Output -> ${file}`);
});
