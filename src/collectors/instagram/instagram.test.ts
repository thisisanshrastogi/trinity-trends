import { InstagramCollector } from "./instagram.collector.js";
import { writeFileSync } from "fs";
import { LLMIntentAnalyzer } from "../../intent/intent.analyzer.js";
import { GeminiFactory } from "../../common/llm/gemini.factory.js";
import { ConsoleTracer } from "../../common/llm/llm.trace.js";

async function run() {
  console.log("🚀 Starting Instagram Collector Test...");
  const query = "Robinhood credit card reward optimization";

  // 1. Intent Analysis
  const tracer = new ConsoleTracer(false);
  const factory = new GeminiFactory({ tracer });
  const analyzer = new LLMIntentAnalyzer(factory, 3);

  const intentResult = await analyzer.analyze(query);

  console.log("\n[*] Intent Analysis");
  console.log(`- Intent: ${intentResult.intent}`);
  console.log(`- Category: ${intentResult.category}`);
  console.log("- Topics Extracted:");
  const tableData = intentResult.topics.map(t => ({ Topic: t }));
  console.table(tableData);

  // 2. Collection
  const collector = new InstagramCollector();

  try {
    const posts = await collector.collect({
      query,
      limit: 20
    });

    console.log(`\n✅ Successfully collected and transcribed ${posts.length} posts!`);

    writeFileSync("instagram_test_output.json", JSON.stringify(posts, null, 2));
    console.log("💾 Saved results to instagram_test_output.json");

    if (posts.length > 0) {
      console.log("\nTop Post Data:");
      console.log(JSON.stringify(posts[0], null, 2));

      const data = posts;

      const { sum, count } = data.reduce((acc, post) => {
        const words = post?.transcript?.split(" ")?.length || 0;
        acc.sum += words;
        acc.count += 1;
        return acc;
      }, { sum: 0, count: 0 });

      console.log(`Average word count per post: ${sum / count}`);
    }
  } catch (error) {
    console.error("❌ Collector failed:", (error as Error).message);
  }
}

run();
