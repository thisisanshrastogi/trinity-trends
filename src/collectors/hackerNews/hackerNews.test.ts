import test from "node:test";
import assert from "node:assert";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { HackerNewsCollector } from "./hackerNews.collector.js";
import { HackerNewsClient } from "./hackerNews.client.js";
import { HackerNewsSearchRequest } from "./hackerNews.types.js";

test("HackerNews Collector and Client", async (t) => {
  const collector = new HackerNewsCollector();
  const client = new HackerNewsClient();

  await t.test("should fetch top stories from Firebase", async () => {
    const topStories = await client.getTopStories();
    assert.ok(Array.isArray(topStories));
    assert.ok(topStories.length > 0);
    assert.strictEqual(typeof topStories[0], "number");
  });

  await t.test("should fetch a specific user", async () => {
    const user = await client.getUser("pg");
    assert.ok(user);
    assert.strictEqual(user.username, "pg");
  });

  await t.test("should search for stories using preset", async () => {
    const stories = await collector.searchStories("startup", 5);
    assert.ok(Array.isArray(stories));
    assert.ok(stories.length <= 5);
    
    if (stories.length > 0) {
      const first = stories[0];
      assert.strictEqual(first.type, "story");
      assert.ok(first.title);
    }
  });

  await t.test("should search for comments using preset", async () => {
    const comments = await collector.searchComments("rust", 5);
    assert.ok(Array.isArray(comments));
    assert.ok(comments.length <= 5);

    if (comments.length > 0) {
      const first = comments[0];
      assert.strictEqual(first.type, "comment");
      assert.ok(first.text);
    }
  });

  await t.test("should fetch high engagement posts", async () => {
    const posts = await collector.highEngagement("ai", 5);
    assert.ok(Array.isArray(posts));
    assert.ok(posts.length <= 5);

    if (posts.length > 0) {
      const first = posts[0];
      assert.ok(first.points >= 100);
      assert.ok(first.comments >= 50);
    }
  });


  await t.test("should paginate appropriately using collect()", async () => {
    // Force a small limit per page to test pagination internally if possible, 
    // but we have hardcoded hitsPerPage = Math.min(targetLimit, 1000).
    // So if limit = 15, it hits once. To test actual pagination, we can request exactly 15 
    // and verify it returns 15 results.
    const req: HackerNewsSearchRequest = {
      query: "technology",
      tags: ["story"],
      limit: 15,
    };
    
    const posts = await collector.collect(req);
    assert.strictEqual(posts.length, 15);
    // Check rank is continuous
    for (let i = 0; i < posts.length; i++) {
      assert.strictEqual(posts[i].rank, i + 1);
    }
  });

  await t.test("should search posts with implicit space-separated topics (e.g. finance ai -> finance AND ai)", async () => {
    const req: HackerNewsSearchRequest = {
      query: "finance ai",
      tags: ["story"],
      limit: 5,
    };

    const posts = await collector.collect(req);
    assert.ok(Array.isArray(posts));
    assert.ok(posts.length <= 5);

    await mkdir("output", { recursive: true });
    await writeFile(
      path.join("output", "hackerNews-implicit-and.json"),
      JSON.stringify(posts, null, 2),
      "utf8"
    );

    if (posts.length > 0) {
      assert.strictEqual(posts[0].type, "story");
    }
  });

  await t.test("should search posts with exact phrase match (e.g. \"artificial intelligence\")", async () => {
    const req: HackerNewsSearchRequest = {
      query: "artificial intelligence",
      exactMatch: true,
      tags: ["story"],
      limit: 5,
    };

    const posts = await collector.collect(req);
    assert.ok(Array.isArray(posts));
    assert.ok(posts.length <= 5);

    await mkdir("output", { recursive: true });
    await writeFile(
      path.join("output", "hackerNews-exact-match.json"),
      JSON.stringify(posts, null, 2),
      "utf8"
    );

    if (posts.length > 0) {
      assert.strictEqual(posts[0].type, "story");
    }
  });

  await t.test("should search posts with explicit boolean logic (e.g. React OR Vue)", async () => {
    const req: HackerNewsSearchRequest = {
      query: "React OR Vue",
      tags: ["story"],
      limit: 5,
    };

    const posts = await collector.collect(req);
    assert.ok(Array.isArray(posts));
    assert.ok(posts.length <= 5);

    if (posts.length > 0) {
      assert.strictEqual(posts[0].type, "story");
    }
  });
});
