import test from "node:test";
import { readFile, writeFile, mkdir } from "fs/promises";
import path from "path";
import { RedditCollector } from "./reddit/reddit.collector.js";
import { YouTubeCollector } from "./youtube/youtube.collector.js";
import { GoogleTrendsCollector } from "./googleTrends/googleTrends.collector.js";
import { ExpansionResult } from "../intent/intent.types.js";

const INPUT_FILE = path.join("output", "expansion-scored.json");
const OUTPUT_FILE = path.join("output", "collection-scored.json");
const LIMIT_PER_SOURCE = 10; // Keeping limit reasonable to avoid immediate rate limiting

test("batch collect topics from ExpansionResult", async () => {
  console.log("Loading expansion result from", INPUT_FILE);
  const data = await readFile(INPUT_FILE, "utf-8");
  const expansionResult: ExpansionResult = JSON.parse(data);

  const redditCollector = new RedditCollector();
  const youtubeCollector = new YouTubeCollector();
  const googleTrendsCollector = new GoogleTrendsCollector();

  const collectionResults: any[] = [];
  const rateLimitFailures: any[] = [];

  for (const candidate of expansionResult.candidates) {
    const query = candidate.query;
    console.log(`\n--- Collecting data for topic: "${query}" ---`);

    const resultEntry: any = {
      query,
      candidateSource: candidate.source,
      errors: {},
    };

    // 1. Reddit
    console.log(`[Reddit] Collecting...`);
    try {
      resultEntry.reddit = await redditCollector.collect({
        query,
        limit: LIMIT_PER_SOURCE,
      });
      console.log(`[Reddit] Fetched ${resultEntry.reddit.length} posts`);
    } catch (err: any) {
      console.error(`[Reddit] Error: ${err.message}`);
      resultEntry.errors.reddit = err.message;
      if (err.message?.toLowerCase().includes("rate limit") || err.response?.status === 429) {
        rateLimitFailures.push({ source: "reddit", query, error: err.message });
      }
    }

    // 2. YouTube
    console.log(`[YouTube] Collecting...`);
    try {
      resultEntry.youtube = await youtubeCollector.collect({
        query,
        limit: LIMIT_PER_SOURCE,
      });
      console.log(`[YouTube] Fetched ${resultEntry.youtube.length} videos`);
    } catch (err: any) {
      console.error(`[YouTube] Error: ${err.message}`);
      resultEntry.errors.youtube = err.message;
      if (err.message?.toLowerCase().includes("rate limit") || err.response?.status === 429) {
        rateLimitFailures.push({ source: "youtube", query, error: err.message });
      }
    }

    // 3. Google Trends
    console.log(`[Google Trends] Collecting...`);
    try {
      resultEntry.googleTrends = await googleTrendsCollector.collect({
        keyword: [query],
        methods: ["interestOverTime", "relatedQueries", "relatedTopics"],
        geo: "US",
      });
      console.log(`[Google Trends] Completed`);
    } catch (err: any) {
      console.error(`[Google Trends] Error: ${err.message}`);
      resultEntry.errors.googleTrends = err.message;
      if (err.message?.toLowerCase().includes("rate limit") || err.response?.status === 429) {
        rateLimitFailures.push({ source: "googleTrends", query, error: err.message });
      }
    }

    collectionResults.push(resultEntry);

    // Optional delay between queries to be nice to APIs
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

  const finalOutput = {
    seed: expansionResult.seed,
    rateLimitFailures,
    results: collectionResults,
  };

  await mkdir("output", { recursive: true });
  await writeFile(OUTPUT_FILE, JSON.stringify(finalOutput, null, 2), "utf8");

  console.log(`\n=== Batch collection finished ===`);
  console.log(`Total topics processed: ${expansionResult.candidates.length}`);
  console.log(`Rate limit failures: ${rateLimitFailures.length}`);
  console.log(`Saved output to ${OUTPUT_FILE}`);
});
