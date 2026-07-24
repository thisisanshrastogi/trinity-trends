import { InstagramClient } from "./instagram.client.js";
import { InstagramParser } from "./instagram.parser.js";
import { AudioTranscriber } from "../core/audio.transcriber.js";
import type {
  InstagramSearchRequest,
  InstagramCollectRequest,
  InstagramPost,
  InstagramSearchPage
} from "./instagram.types.js";
import type { Collector } from "../core/core.interfaces.js";

export class InstagramCollector implements Collector<InstagramCollectRequest, InstagramPost[]> {
  public readonly id = "instagram";
  private transcriber = new AudioTranscriber();

  constructor(
    private readonly client = new InstagramClient(),
    private readonly parser = new InstagramParser(),
  ) { }

  public async search(req: InstagramSearchRequest): Promise<InstagramSearchPage> {
    const rawJsonString = await this.client.search(req);
    return this.parser.parse(rawJsonString);
  }

  public async collect(req: InstagramCollectRequest): Promise<InstagramPost[]> {
    const limit = req.limit ?? 10;
    const seen = new Set<string>();

    const page = await this.search(req);
    const postsToProcess = page.posts.filter(p => !seen.has(p.pk)).slice(0, limit);

    if (postsToProcess.length === 0) {
      return [];
    }

    // Mark all as seen
    for (const post of postsToProcess) {
      seen.add(post.pk);
    }

    // Batch-transcribe all URLs at once (loads the whisper model only once)
    const urls = postsToProcess.map(p => p.url);
    console.log(`[InstagramCollector] Batch-transcribing ${urls.length} posts...`);

    let transcripts: Map<string, { transcript: string; metadata?: any }>;
    try {
      transcripts = await this.transcriber.processBatch(urls);
    } catch (err) {
      console.warn(`[InstagramCollector] Batch transcription failed, posts will have empty transcripts:`, (err as Error).message);
      transcripts = new Map();
    }

    // Assemble final posts with transcripts and yt-dlp metadata
    const collectedPosts: InstagramPost[] = postsToProcess.map((post, idx) => {
      const data = transcripts.get(post.url);
      const meta = data?.metadata || {};

      return {
        ...post,
        caption: meta.description || post.caption || "",
        like_count: meta.like_count ?? post.like_count ?? 0,
        comment_count: meta.comment_count ?? post.comment_count ?? 0,
        username: meta.channel || post.username || "",
        full_name: meta.uploader || post.full_name || "",
        taken_at: meta.timestamp || post.taken_at || 0,
        transcript: data?.transcript || "",
        rank: idx + 1,
      };
    });

    console.log(`[InstagramCollector] Collected ${collectedPosts.length} posts (${transcripts.size} transcribed)`);
    return collectedPosts;
  }
}
