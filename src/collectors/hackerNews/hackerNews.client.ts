import { AxiosInstance } from "axios";
import { createHttpClient } from "../../common/http/client.js";
import { HackerNewsSearchRequest } from "./hackerNews.types.js";

export class HackerNewsClient {
  static readonly BASE = "https://hn.algolia.com/api/v1";

  readonly httpClient: AxiosInstance;
  readonly firebaseClient: AxiosInstance;

  constructor() {
    this.httpClient = createHttpClient({
      baseURL: HackerNewsClient.BASE,
    });
    this.firebaseClient = createHttpClient({
      baseURL: HackerNewsClient.FIREBASE_BASE,
    });
  }

  async search(req: HackerNewsSearchRequest): Promise<any> {
    const endpoint = req.sort === "date" ? "/search_by_date" : "/search";
    
    const params: Record<string, string | number> = {};

    if (req.query) {
      if (req.exactMatch) {
        params["query"] = `"${req.query}"`;
      } else {
        let finalQuery = req.query.trim();
        if (!/\b(AND|OR)\b/i.test(finalQuery) && /\s+/.test(finalQuery)) {
          finalQuery = finalQuery.split(/\s+/).join(" AND ");
        }
        params["query"] = finalQuery;
      }
    }

    if (req.page !== undefined) params["page"] = req.page;
    if (req.limit !== undefined) params["hitsPerPage"] = req.limit;

    if (req.tags && req.tags.length > 0) {
      params["tags"] = req.tags.join(",");
    }

    if (req.attributesToSearch && req.attributesToSearch.length > 0) {
      params["restrictSearchableAttributes"] = req.attributesToSearch.join(",");
    }

    const filters = this.buildFilters(req);
    if (filters) {
      params["filters"] = filters;
    }

    const res = await this.httpClient.get(endpoint, {
      params,
    });

    return res.data;
  }

  async getItem(id: number): Promise<any> {
    const res = await this.httpClient.get(`/items/${id}`);
    return res.data;
  }

  async getUser(username: string): Promise<any> {
    const res = await this.httpClient.get(`/users/${username}`);
    return res.data;
  }

  // Note: Firebase API paths are used for getTopStories, getNewStories, getBestStories
  // HN Firebase API: https://hacker-news.firebaseio.com/v0/
  static readonly FIREBASE_BASE = "https://hacker-news.firebaseio.com/v0";

  async getTopStories(): Promise<number[]> {
    const res = await this.firebaseClient.get(`/topstories.json`);
    return res.data;
  }

  async getNewStories(): Promise<number[]> {
    const res = await this.firebaseClient.get(`/newstories.json`);
    return res.data;
  }

  async getBestStories(): Promise<number[]> {
    const res = await this.firebaseClient.get(`/beststories.json`);
    return res.data;
  }

  private buildFilters(req: HackerNewsSearchRequest): string {
    const filters: string[] = [];

    if (req.minPoints !== undefined) filters.push(`points>=${req.minPoints}`);
    if (req.maxPoints !== undefined) filters.push(`points<=${req.maxPoints}`);
    
    if (req.minComments !== undefined) filters.push(`num_comments>=${req.minComments}`);
    if (req.maxComments !== undefined) filters.push(`num_comments<=${req.maxComments}`);

    if (req.author) filters.push(`author:${req.author}`);

    if (req.after) filters.push(`created_at_i>${Math.floor(req.after.getTime() / 1000)}`);
    if (req.before) filters.push(`created_at_i<${Math.floor(req.before.getTime() / 1000)}`);

    return filters.join(" AND ");
  }
}
