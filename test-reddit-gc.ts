import * as fs from "fs/promises";
import { RedditClient } from "./src/collectors/reddit/reddit.client.js";

async function testGroupChatExtraction() {
  console.log("Initializing RedditClient...");
  const client = new RedditClient();

  const url = "https://old.reddit.com/r/RobinhoodGC/?share_id=7TlWiRP7GlCajCptiEmow";
  console.log(`Extracting posts and comments from: ${url}`);

  try {
    const data = await client.extractGroupChat(url);

    console.log(`\nExtraction complete!`);
    console.log(`Total Posts: ${data.posts.length}`);
    console.log(`Total Comments: ${data.comments.length}`);

    const outputPath = "robinhood-gc-data.json";
    console.log(`\nSaving data to ${outputPath}...`);

    // Write formatted JSON to file
    await fs.writeFile(
      outputPath,
      JSON.stringify(data, null, 2),
      "utf-8"
    );

    console.log("Data successfully saved!");
  } catch (error) {
    console.error("An error occurred during extraction:", error);
  }
}

testGroupChatExtraction().catch(console.error);
