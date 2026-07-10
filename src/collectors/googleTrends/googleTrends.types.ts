export type GoogleTrendsMethod =
  | "autoComplete"
  | "dailyTrends"
  | "interestOverTime"
  | "interestByRegion"
  | "relatedQueries"
  | "relatedTopics";

export type GoogleTrendsResolution = "COUNTRY" | "REGION" | "CITY" | "DMA";

export interface GoogleTrendsMethodsOptions {
  autoComplete?: {
    keyword: string;
    hl?: string;
  };
  dailyTrends?: {
    geo: string;
    hl?: string;
    timezone?: number;
    // should be less than 15 minutes old
    trendDate?: Date;
  };
  interestOverTime?: {
    keyword: string[];
    // default is 2004-01-01
    startTime?: Date;
    // default is Date.now()
    endTime?: Date;
    geo?: string;
    hl?: string;
    timezone?: number;
    category?: number;
  };
  interestByRegion?: {
    keyword: string[];
    geo?: string;
    startTime?: Date;
    endTime?: Date;
    resolution?: GoogleTrendsResolution;
    hl?: string;
    timezone?: number;
    category?: number;
  };
  relatedQueries?: {
    keyword: string[];
    geo?: string;
    startTime?: Date;
    endTime?: Date;
    hl?: string;
    timezone?: number;
    category?: number;
  };
  relatedTopics?: {
    keyword: string[];
    geo?: string;
    startTime?: Date;
    endTime?: Date;
    hl?: string;
    timezone?: number;
    category?: number;
  };
}

export interface GoogleTrendsSearchRequest {
  query?: string;
  methods: GoogleTrendsMethod[];
  options?: GoogleTrendsMethodsOptions;
}

// ---- Raw method output (the package returns JSON strings) ----
export interface GoogleTrendsRawResult {
  method: GoogleTrendsMethod;
  raw: string;
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

export interface RankedKeyword {
  query?: string;
  topic?: { mid: string; title: string; type: string };
  value: number;
  formattedValue: string;
  link?: string;
  hasData?: boolean;
}

export interface RankedListResult {
  top: RankedKeyword[];
  rising: RankedKeyword[];
}

export interface DailyTrendItem {
  title: string;
  formattedTraffic: string;
  traffic: number;
  relatedQueries: string[];
  articles: {
    title: string;
    url: string;
    source?: string;
    snippet?: string;
  }[];
  shareUrl?: string;
}

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

export interface GoogleTrendsPage {
  query?: string;
  results: GoogleTrendsMethodResult[];
}