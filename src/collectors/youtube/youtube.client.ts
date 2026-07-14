// youtube.client.ts

import type { AxiosInstance } from "axios";
import type { ClientLike } from "../core/core.interfaces.js";
import type { YouTubeSearchRequest } from "./youtube.types.js";
import { createHttpClient } from "../../common/http/client.js";
import { encodeSp } from "./youtube.filters.js";
import {
  extractInnertubeConfig,
  type InnertubeConfig,
} from "./youtube.config.js";

export class YouTubeClient implements ClientLike<YouTubeSearchRequest> {
  static readonly BASE = "https://www.youtube.com";
  static readonly HEADERS = {
    "User-Agent":
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/138.0 Safari/537.36",
  };

  readonly httpClient: AxiosInstance;
  private config: InnertubeConfig | null = null;

  constructor() {
    this.httpClient = createHttpClient({
      baseURL: YouTubeClient.BASE,
      headers: YouTubeClient.HEADERS,
    });
  }

  buildSearchPath(req: YouTubeSearchRequest): string {
    const params = new URLSearchParams();
    params.set("search_query", req.query);
    if (req.filters?.length) {
      const { sp } = encodeSp(req.filters);
      params.set("sp", sp);
    }
    return `/results?${params.toString()}`;
  }

  async search(req: YouTubeSearchRequest): Promise<string> {
    const path = this.buildSearchPath(req);
    const { data } = await this.httpClient.get<string>(path, {
      params: req.region ? { gl: req.region } : undefined,
      responseType: "text",
    });

    try {
      this.config = extractInnertubeConfig(data);
    } catch {
      /* keep prior config if extraction fails */
    }

    return data;
  }

  getConfig(): InnertubeConfig | null {
    return this.config;
  }

  async innertubeSearch(
    token: string,
    cfg: InnertubeConfig,
    region?: string,
  ): Promise<unknown> {
    const body = {
      context: {
        client: {
          clientName: cfg.clientName,
          clientVersion: cfg.clientVersion,
          hl: "en",
          gl: region ?? "US",
          visitorData: cfg.visitorData,
        },
      },
      continuation: token,
    };

    const { data } = await this.httpClient.post(
      `/youtubei/v1/search?key=${cfg.apiKey}&prettyPrint=false`,
      body,
      { headers: { "Content-Type": "application/json" } },
    );
    return data;
  }

  async innertubePlayer(
    videoId: string,
    cfg: InnertubeConfig,
    region?: string,
  ): Promise<unknown> {
    const body = {
      context: {
        client: {
          clientName: cfg.clientName,
          clientVersion: cfg.clientVersion,
          hl: "en",
          gl: region ?? "US",
          visitorData: cfg.visitorData,
        },
      },
      videoId,
    };

    const { data } = await this.httpClient.post(
      `/youtubei/v1/player?key=${cfg.apiKey}&prettyPrint=false`,
      body,
      { headers: { "Content-Type": "application/json" } },
    );
    return data;
  }
}
