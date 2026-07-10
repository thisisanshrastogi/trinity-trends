import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, writeFile } from "fs/promises";
import path from "path";

import { RedditCollector } from "./reddit.collector.js";

const OUTPUT_DIR = "output";
const QUERY = "finance";
const SORT = "new";
const TIME = "all";

async function saveJson(filePath: string, value: unknown) {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(filePath, JSON.stringify(value, null, 2), "utf8");
}

test("reddit search hits the live API and parses a page", async () => {
  const collector = new RedditCollector();

  const page = await collector.search({
    query: QUERY,
    sort: SORT,
    time: TIME,
  });

  assert.ok(
    page.posts.length > 0,
    "expected Reddit to return at least one post",
  );
  assert.equal(typeof page.hasNext, "boolean");
  assert.ok(page.posts[0].title.length > 0);
  assert.ok(page.posts[0].permalink.startsWith("https://old.reddit.com/"));

  const file = path.join(OUTPUT_DIR, "reddit-search.json");

  await saveJson(file, page);

  console.log();
  console.log(`Saved ${page.posts.length} search posts`);
  console.log(`Next cursor: ${page.after ?? "(none)"}`);
  console.log(`Output -> ${file}`);
});

test("reddit collect hits the live API and respects the limit", async () => {
  const collector = new RedditCollector();
  const limit = 50;

  const posts = await collector.collect({
    query: QUERY,
    sort: SORT,
    time: TIME,
    limit,
  });

  assert.equal(
    posts.length,
    limit,
    "collect() should keep fetching pages until the requested limit is met",
  );

  const uniqueIds = new Set(posts.map((post) => post.postId));

  assert.equal(
    uniqueIds.size,
    posts.length,
    "collect() should not duplicate posts",
  );
  assert.deepEqual(
    posts.map((post) => post.rank),
    posts.map((_, index) => index + 1),
    "collect() should assign a global rank across pages",
  );
  assert.ok(posts[0].title.length > 0);

  const file = path.join(OUTPUT_DIR, "reddit-collect.json");

  await saveJson(file, posts);

  console.log();
  console.log(`Saved ${posts.length} collected posts`);
  console.log(`Limit -> ${limit}`);
  console.log(`Output -> ${file}`);
});
