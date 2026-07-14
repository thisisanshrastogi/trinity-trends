import axios, { AxiosInstance } from "axios";
//@ts-expect-error
import googleTrends from "google-trends-api";
import { ClientLike } from "../core/core.interfaces.js";
import {
  GoogleTrendsSearchRequest,
  GoogleTrendsMethod,
} from "./googleTrends.types.js";

type MethodFn = (options: Record<string, unknown>) => Promise<string>;

export class GoogleTrendsClient implements ClientLike<GoogleTrendsSearchRequest> {
  // The interface requires an AxiosInstance. The package does its own
  // HTTP internally, so this is present only to satisfy the contract.
  readonly httpClient: AxiosInstance;

  private readonly methods: Record<GoogleTrendsMethod, MethodFn>;

  constructor() {
    this.httpClient = axios.create();

    this.methods = {
      autoComplete: googleTrends.autoComplete.bind(googleTrends),
      dailyTrends: googleTrends.dailyTrends.bind(googleTrends),
      interestOverTime: googleTrends.interestOverTime.bind(googleTrends),
      interestByRegion: googleTrends.interestByRegion.bind(googleTrends),
      relatedQueries: googleTrends.relatedQueries.bind(googleTrends),
      relatedTopics: googleTrends.relatedTopics.bind(googleTrends),
    };
  }

  // Single method → single raw JSON string, exactly as the interface requires.
  async search(req: GoogleTrendsSearchRequest): Promise<string> {
    const options = this.buildOptions(req);
    return this.methods[req.method](options);
  }

  private buildOptions(
    req: GoogleTrendsSearchRequest,
  ): Record<string, unknown> {
    const options: Record<string, unknown> = {};

    if (req.method === "autoComplete") {
      options["keyword"] = req.keyword[0];
    } else if (req.method === "dailyTrends") {
      if (req.geo != null) options["geo"] = req.geo;
      if (req.trendDate != null) options["trendDate"] = req.trendDate;
    } else {
      options["keyword"] =
        req.keyword.length === 1 ? req.keyword[0] : req.keyword;
    }

    if (req.geo != null && req.method !== "dailyTrends") {
      options["geo"] = req.geo;
    }
    if (req.hl != null) options["hl"] = req.hl;
    if (req.timezone != null) options["timezone"] = req.timezone;
    if (req.category != null) options["category"] = req.category;
    if (req.startTime != null) options["startTime"] = req.startTime;
    if (req.endTime != null) options["endTime"] = req.endTime;
    if (req.resolution != null) options["resolution"] = req.resolution;

    return options;
  }
}
