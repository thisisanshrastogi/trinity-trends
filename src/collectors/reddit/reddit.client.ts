import { AxiosInstance } from "axios";
import { createHttpClient } from "../../common/http/client.js";
import { RedditSearchRequest } from "./reddit.types.js";
import { ClientLike } from "../core/core.interfaces.js";

export class RedditClient implements ClientLike<RedditSearchRequest> {
  static readonly BASE = "https://old.reddit.com";
  static readonly HEADERS = {
    "User-Agent": "linux:trinity-trends:v0.1 ",
    Accept: "text/html,application/xhtml+xml",
    "Accept-Language": "en-US,en;q=0.9",
  };

  readonly httpClient: AxiosInstance;
  constructor() {
    this.httpClient = createHttpClient({
      baseURL: RedditClient.BASE,
      headers: RedditClient.HEADERS,
    });
  }

  async search(req: RedditSearchRequest): Promise<string> {
    const params: Record<string, string> = {};

    // query can also be written with boolean operators, e.g. "golang AND (finance OR crypto)"

    params["q"] = req.query;

    if (req.sort) params["sort"] = req.sort;

    if (req.time) params["t"] = req.time;

    if (req.after) params["after"] = req.after;

    if (req.cursorCount != null) {
      params["count"] = String(req.cursorCount);
    }

    const res = await this.fetchWithBackoff(`${RedditClient.BASE}/search`, params);

    return res.data;
  }
  async extractGroupChat(url: string): Promise<{ posts: any[]; comments: any[] }> {
    let subreddit = url;
    if (url.includes("/r/")) {
      const match = url.match(/\/r\/([^/]+)/);
      if (match) subreddit = match[1];
    }

    const posts: any[] = [];
    const comments: any[] = [];

    let postsAfter: string | undefined = undefined;
    do {
      const res = await this.fetchWithBackoff(`${RedditClient.BASE}/r/${subreddit}/.json`,
        postsAfter ? { after: postsAfter, limit: 100 } : { limit: 100 }
      );
      const children = res.data?.data?.children || [];
      if (children.length === 0) break;

      posts.push(...children.map((c: any) => c.data));
      postsAfter = res.data?.data?.after;

      if (postsAfter) await new Promise((r) => setTimeout(r, 1000));
    } while (postsAfter);

    let commentsAfter: string | undefined = undefined;
    do {
      const res = await this.fetchWithBackoff(`${RedditClient.BASE}/r/${subreddit}/comments/.json`,
        commentsAfter ? { after: commentsAfter, limit: 100 } : { limit: 100 }
      );
      const children = res.data?.data?.children || [];
      if (children.length === 0) break;

      comments.push(...children.map((c: any) => c.data));
      commentsAfter = res.data?.data?.after;

      if (commentsAfter) await new Promise((r) => setTimeout(r, 1000));
    } while (commentsAfter);

    return { posts, comments };
  }

  private async fetchWithBackoff(url: string, params?: Record<string, any>, maxRetries = 5): Promise<any> {
    let delay = 2000;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.httpClient.get(url, { params });
      } catch (error: any) {
        const status = error.response?.status;
        if (status === 429 || status === 403 || status >= 500) {
          if (attempt === maxRetries) throw error;
          console.warn(`[RedditClient] API rate limited/error (Status: ${status}). Retrying in ${delay}ms...`);
          await new Promise((r) => setTimeout(r, delay));
          delay *= 2;
        } else {
          throw error;
        }
      }
    }
  }
}
