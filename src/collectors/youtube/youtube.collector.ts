// youtube.collector.ts

import { YouTubeClient } from "./youtube.client.js";
import { YouTubeParser } from "./youtube.parser.js";
import type {
  YouTubeSearchRequest,
  YouTubeSearchPage,
  YouTubeVideo,
} from "./youtube.types.js";
import type { InnertubeConfig } from "./youtube.config.js";

export interface YouTubeClientLike {
  /** Fetch results HTML and cache InnerTube config found inside it. */
  search(req: YouTubeSearchRequest): Promise<string>;
  /** Raw InnerTube continuation call; needs config from a prior search(). */
  innertubeSearch(
    token: string,
    cfg: InnertubeConfig,
    region?: string,
  ): Promise<unknown>;
  /** Config scraped from the most recent search(), if any. */
  getConfig(): InnertubeConfig | null;
  /** Optional: get full video details using the Innertube player endpoint. */
  innertubePlayer?(
    videoId: string,
    cfg: InnertubeConfig,
    region?: string,
  ): Promise<unknown>;
}

export interface YouTubeParserLike {
  parse(html: string): YouTubeSearchPage;
  parseContinuation(data: unknown): YouTubeSearchPage;
}

export interface YouTubeCollectRequest extends YouTubeSearchRequest {
  limit?: number;
}

export class YouTubeCollector {
  constructor(
    private readonly client: YouTubeClientLike = new YouTubeClient(),
    private readonly parser: YouTubeParserLike = new YouTubeParser(),
  ) {}

  async search(req: YouTubeSearchRequest): Promise<YouTubeSearchPage> {
    const html = await this.client.search(req);
    return this.parser.parse(html);
  }

  async collect(req: YouTubeCollectRequest): Promise<YouTubeVideo[]> {
    const videos: YouTubeVideo[] = [];
    const limit = req.limit ?? Number.MAX_SAFE_INTEGER;
    const seen = new Set<string>();

    let continuation = req.continuation;

    while (videos.length < limit) {
      // First iteration (no token) → HTML page, which also primes config.
      // Later iterations → InnerTube continuation call.
      const page = continuation
        ? await this.continue(continuation, req.region)
        : await this.search(req);

      const newVideos: YouTubeVideo[] = [];
      for (const video of page.videos) {
        if (videos.length + newVideos.length >= limit) break;
        if (seen.has(video.id)) continue;
        seen.add(video.id);
        newVideos.push({ ...video, rank: videos.length + newVideos.length + 1 });
      }

      const cfg = this.client.getConfig();
      if (this.client.innertubePlayer && cfg) {
        for (let i = 0; i < newVideos.length; i += 5) {
          const chunk = newVideos.slice(i, i + 5);
          await Promise.all(
            chunk.map(async (v) => {
              try {
                const data: any = await this.client.innertubePlayer!(
                  v.id,
                  cfg,
                  req.region,
                );
                if (data?.videoDetails?.title) {
                  v.title = data.videoDetails.title;
                }
                if (data?.videoDetails?.shortDescription) {
                  v.description = data.videoDetails.shortDescription;
                }
              } catch {
                // Ignore errors and keep search page metadata
              }
            }),
          );
        }
      }

      videos.push(...newVideos);

      if (
        !page.hasMore ||
        !page.continuation ||
        page.continuation === continuation
      ) {
        break;
      }
      continuation = page.continuation;
    }

    return videos;
  }

  private async continue(
    token: string,
    region?: string,
  ): Promise<YouTubeSearchPage> {
    const cfg = this.client.getConfig();
    if (!cfg) {
      throw new Error(
        "No InnerTube config available; run search() before continuing",
      );
    }
    const data = await this.client.innertubeSearch(token, cfg, region);
    return this.parser.parseContinuation(data);
  }
}
