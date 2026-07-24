import type { InstagramSearchPage, InstagramPost, InstagramScraperOutput } from "./instagram.types.js";

export class InstagramParser {
  /**
   * Parse the JSON output from the Python scraper into InstagramSearchPage.
   *
   * The scraper outputs:
   *   { metadata: {...}, results: { "query": ["url1", "url2", ...] } }
   *
   * Since the scraper only collects URLs (no engagement data from the page),
   * we extract post codes from the URLs and create minimal InstagramPost objects.
   * The collector can later enrich these with transcription data.
   */
  public parse(jsonString: string): InstagramSearchPage {
    let data: InstagramScraperOutput;
    try {
      data = JSON.parse(jsonString);
    } catch (e) {
      throw new Error("Failed to parse Instagram scraper output: " + (e as Error).message);
    }

    const posts: InstagramPost[] = [];
    const nowUnix = Math.floor(Date.now() / 1000);

    for (const [query, urls] of Object.entries(data.results ?? {})) {
      for (const url of urls) {
        // Extract post code from URL like https://www.instagram.com/p/ABC123/
        const codeMatch = url.match(/\/(?:p|reel)\/([A-Za-z0-9_-]+)/);
        const code = codeMatch?.[1] ?? "";
        if (!code) continue;

        posts.push({
          pk: code, // Use code as pk since we don't have the numeric pk
          code,
          media_type: 0, // Unknown from URL-only scrape
          username: "",
          full_name: "",
          is_verified: false,
          width: 0,
          height: 0,
          caption: "",
          like_count: 0,
          comment_count: 0,
          view_count: 0,
          taken_at: nowUnix,
          engagement_velocity: 0,
          url,
          rank: posts.length + 1,
        });
      }
    }

    return { posts };
  }
}