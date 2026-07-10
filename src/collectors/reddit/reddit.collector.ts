import { RedditClient } from "./reddit.client.js";
import { RedditParser } from "./reddit.parser.js";
import {
  RedditSearchRequest,
  RedditSearchPage,
  RedditSearchPost,
} from "./reddit.types.js";

export interface RedditClientLike {
  search(req: RedditSearchRequest): Promise<string>;
}

export interface RedditParserLike {
  parse(html: string): RedditSearchPage;
}

export interface RedditCollectRequest extends RedditSearchRequest {
  limit?: number;
}

export class RedditCollector {
  constructor(
    private readonly client: RedditClientLike = new RedditClient(),
    private readonly parser: RedditParserLike = new RedditParser(),
  ) {}


  async search(req: RedditSearchRequest): Promise<RedditSearchPage> {
    const html = await this.client.search(req);

    return this.parser.parse(html);
  }

  async collect(req: RedditCollectRequest): Promise<RedditSearchPost[]> {
    const posts: RedditSearchPost[] = [];

    const limit = req.limit ?? Number.MAX_SAFE_INTEGER;

    let after = req.after;
    let cursorCount = req.cursorCount ?? 0;

    while (posts.length < limit) {
      const page = await this.search({
        ...req,
        after,
        cursorCount,
      });

      const remaining = limit - posts.length;
      const rankOffset = posts.length;

      posts.push(
        ...page.posts.slice(0, remaining).map((post, index) => ({
          ...post,
          rank: rankOffset + index + 1,
        })),
      );

      if (!page.hasNext || !page.after || page.after === after) break;

      after = page.after;
      cursorCount = page.count ?? cursorCount + page.posts.length;
    }

    return posts;
  }
}
