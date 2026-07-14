export type GoogleTrendsMethod =
  | "autoComplete"
  | "dailyTrends"
  | "interestOverTime"
  | "interestByRegion"
  | "relatedQueries"
  | "relatedTopics";

export type GoogleTrendsResolution = "COUNTRY" | "REGION" | "CITY" | "DMA";

// ---- Requests ----

// Single-method request — consumed by the client's search().
export interface GoogleTrendsSearchRequest {
  method: GoogleTrendsMethod;
  keyword: string[];
  geo?: string;
  hl?: string;
  timezone?: number;
  category?: number;
  startTime?: Date;
  endTime?: Date;
  resolution?: GoogleTrendsResolution;
  trendDate?: Date; // dailyTrends only
}

// Multi-method request — consumed by the collector.
export interface GoogleTrendsCollectRequest {
  query?: string;
  keyword?: string[];
  methods: GoogleTrendsMethod[];
  geo?: string;
  hl?: string;
  timezone?: number;
  category?: number;
  startTime?: Date;
  endTime?: Date;
  resolution?: GoogleTrendsResolution;
  trendDate?: Date;
}

// ---- Parsed shapes ----

export interface AutoCompleteItem {
  mid: string;
  title: string;
  type: string;
}

export interface TimelinePoint {
  time: string;
  formattedTime: string;
  formattedAxisTime: string;
  value: number[];
  hasData?: boolean[];
}

export interface InterestOverTime {
  timelineData: TimelinePoint[];
  averages: number[];
}

export interface RegionValue {
  geoCode: string;
  geoName: string;
  value: number[];
  maxValueIndex: number;
  formattedValue: string[];
}

export interface RankedTopic {
  mid: string;
  title: string;
  type: string;
}

export interface RankedKeyword {
  query?: string;
  topic?: RankedTopic;
  value: number;
  formattedValue: string;
  link?: string;
  hasData?: boolean;
}

export interface RankedListResult {
  top: RankedKeyword[];
  rising: RankedKeyword[];
}

export interface DailyTrendArticle {
  title: string;
  url: string;
  source?: string;
  snippet?: string;
}

export interface DailyTrendItem {
  title: string;
  formattedTraffic: string;
  traffic: number;
  relatedQueries: string[];
  articles: DailyTrendArticle[];
  shareUrl?: string;
}

// ---- Per-method result (discriminated by `method`) ----

export interface GoogleTrendsMethodResult {
  method: GoogleTrendsMethod;
  autoComplete?: AutoCompleteItem[];
  dailyTrends?: DailyTrendItem[];
  interestOverTime?: InterestOverTime;
  interestByRegion?: RegionValue[];
  relatedQueries?: RankedListResult;
  relatedTopics?: RankedListResult;
  error?: string;
}
