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

    const res = await this.httpClient.get(`${RedditClient.BASE}/search`, {
      params,
    });

    return res.data;
  }
}
