//@ts-expect-error - google-trends-api has no type definitions
import googleTrends from "google-trends-api";
import { ClientLike } from "../core/core.interfaces.js";
import {
  GoogleTrendsSearchRequest,
  GoogleTrendsRawResult,
  GoogleTrendsMethod,
  GoogleTrendsMethodsOptions,
} from "./googleTrends.types.js";

type MethodFn = (options: Record<string, unknown>) => Promise<string>;

export class GoogleTrendsClient implements ClientLike<GoogleTrendsSearchRequest> {
  private readonly methods: Record<GoogleTrendsMethod, MethodFn>;

  constructor() {
    this.methods = {
      autoComplete: googleTrends.autoComplete.bind(googleTrends),
      dailyTrends: googleTrends.dailyTrends.bind(googleTrends),
      interestOverTime: googleTrends.interestOverTime.bind(googleTrends),
      interestByRegion: googleTrends.interestByRegion.bind(googleTrends),
      relatedQueries: googleTrends.relatedQueries.bind(googleTrends),
      relatedTopics: googleTrends.relatedTopics.bind(googleTrends),
    };
  }

  async search(req: GoogleTrendsSearchRequest): Promise<string> {
    const out: GoogleTrendsRawResult[] = [];

    for (const method of req.methods) {
      const options = this.buildOptions(method, req);
      const raw = await this.methods[method](options);
      out.push({ method, raw });
    }

    return JSON.stringify(out);
  }

  private buildOptions(
    method: GoogleTrendsMethod,
    req: GoogleTrendsSearchRequest,
  ): Record<string, unknown> {
    const provided =
      (req.options?.[method] as GoogleTrendsMethodsOptions[typeof method]) ??
      {};

    const options: Record<string, unknown> = { ...provided };

    // fall back to the top-level query when a keyword isn't explicitly set
    if (req.query != null) {
      if (method === "autoComplete") {
        options["keyword"] ??= req.query;
      } else if (method !== "dailyTrends") {
        options["keyword"] ??= [req.query];
      }
    }

    return options;
  }
}
