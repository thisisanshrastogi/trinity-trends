import { HackerNewsClient } from "./hackerNews.client.js";
import { HackerNewsParser } from "./hackerNews.parser.js";
import {
  HackerNewsSearchRequest,
  HackerNewsSearchPage,
  HackerNewsPost,
} from "./hackerNews.types.js";

export interface HackerNewsClientLike {
  search(req: HackerNewsSearchRequest): Promise<any>;
}

export interface HackerNewsParserLike {
  parseSearch(data: any): HackerNewsSearchPage;
}

export class HackerNewsCollector {
  constructor(
    private readonly client: HackerNewsClientLike = new HackerNewsClient(),
    private readonly parser: HackerNewsParserLike = new HackerNewsParser(),
  ) {}

  async search(req: HackerNewsSearchRequest): Promise<HackerNewsSearchPage> {
    const data = await this.client.search(req);
    return this.parser.parseSearch(data);
  }

  async collect(req: HackerNewsSearchRequest): Promise<HackerNewsPost[]> {
    const posts: HackerNewsPost[] = [];
    const targetLimit = req.limit ?? Number.MAX_SAFE_INTEGER;
    
    // Algolia typically has a max hitsPerPage of 1000.
    const hitsPerPage = Math.min(targetLimit, 1000);
    let currentPage = req.page ?? 0;

    while (posts.length < targetLimit) {
      const pageReq = {
        ...req,
        page: currentPage,
        limit: hitsPerPage,
      };

      const page = await this.search(pageReq);
      
      const remaining = targetLimit - posts.length;
      const rankOffset = posts.length;

      posts.push(
        ...page.posts.slice(0, remaining).map((post, index) => ({
          ...post,
          rank: rankOffset + index + 1,
        }))
      );

      if (!page.hasNext) {
        break;
      }

      currentPage++;
    }

    return posts;
  }

  // --- Presets ---

  async searchStories(query: string, limit: number = 100): Promise<HackerNewsPost[]> {
    return this.collect({
      query,
      tags: ["story"],
      limit,
    });
  }

  async searchComments(query: string, limit: number = 100): Promise<HackerNewsPost[]> {
    return this.collect({
      query,
      tags: ["comment"],
      limit,
    });
  }

  async searchAskHN(query: string, limit: number = 100): Promise<HackerNewsPost[]> {
    return this.collect({
      query,
      tags: ["ask_hn"],
      limit,
    });
  }

  async searchShowHN(query: string, limit: number = 100): Promise<HackerNewsPost[]> {
    return this.collect({
      query,
      tags: ["show_hn"],
      limit,
    });
  }

  async latestStories(query?: string, limit: number = 100): Promise<HackerNewsPost[]> {
    return this.collect({
      query,
      tags: ["story"],
      sort: "date",
      limit,
    });
  }

  async highEngagement(query?: string, limit: number = 100): Promise<HackerNewsPost[]> {
    return this.collect({
      query,
      tags: ["story"],
      minPoints: 100,
      minComments: 50,
      limit,
    });
  }
}
