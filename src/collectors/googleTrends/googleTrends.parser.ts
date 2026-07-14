import {
  GoogleTrendsMethod,
  GoogleTrendsMethodResult,
  AutoCompleteItem,
  InterestOverTime,
  RegionValue,
  RankedListResult,
  DailyTrendItem,
} from "./googleTrends.types.js";

export function detectHttpError(raw: string): string | undefined {
  const head = raw.slice(0, 500);
  if (/Error 429/i.test(head) || /rate.?limit/i.test(head)) {
    return "rate limited (HTTP 429)";
  }
  if (/^\s*</.test(raw)) {
    return "unexpected HTML response";
  }
  return undefined;
}

// google-trends-api may prefix payloads with anti-hijacking junk, e.g. ")]}'"
export function stripPrefix(raw: string): string {
  const start = raw.search(/[[{]/);
  return start === -1 ? raw : raw.slice(start);
}

export function safeParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(stripPrefix(raw)) as T;
  } catch {
    return undefined;
  }
}

export class GoogleTrendsParser {
  parse(method: GoogleTrendsMethod, raw: string): GoogleTrendsMethodResult {
    const httpError = detectHttpError(raw);
    if (httpError) {
      return { method, error: httpError };
    }

    const parsed = safeParse<any>(raw);
    if (parsed === undefined) {
      return { method, error: "failed to parse response" };
    }

    switch (method) {
      case "autoComplete":
        return { method, autoComplete: this.parseAutoComplete(parsed) };
      case "dailyTrends":
        return { method, dailyTrends: this.parseDailyTrends(parsed) };
      case "interestOverTime":
        return { method, interestOverTime: this.parseInterestOverTime(parsed) };
      case "interestByRegion":
        return { method, interestByRegion: this.parseInterestByRegion(parsed) };
      case "relatedQueries":
        return { method, relatedQueries: this.parseRankedList(parsed) };
      case "relatedTopics":
        return { method, relatedTopics: this.parseRankedList(parsed) };
      default:
        return { method, error: "unknown method" };
    }
  }

  private parseAutoComplete(parsed: any): AutoCompleteItem[] {
    const items = parsed?.default?.topics ?? [];
    return items.map((t: any) => ({
      mid: t.mid ?? "",
      title: t.title ?? "",
      type: t.type ?? "",
    }));
  }

  private parseInterestOverTime(parsed: any): InterestOverTime {
    const tl = parsed?.default?.timelineData ?? [];
    return {
      averages: parsed?.default?.averages ?? [],
      timelineData: tl.map((p: any) => ({
        time: p.time ?? "",
        formattedTime: p.formattedTime ?? "",
        formattedAxisTime: p.formattedAxisTime ?? "",
        value: p.value ?? [],
        hasData: p.hasData,
      })),
    };
  }

  private parseInterestByRegion(parsed: any): RegionValue[] {
    const data = parsed?.default?.geoMapData ?? [];
    return data.map((r: any) => ({
      geoCode: r.geoCode ?? "",
      geoName: r.geoName ?? "",
      value: r.value ?? [],
      maxValueIndex: r.maxValueIndex ?? 0,
      formattedValue: r.formattedValue ?? [],
    }));
  }

  private parseRankedList(parsed: any): RankedListResult {
    const lists = parsed?.default?.rankedList ?? [];
    const map = (k: any) => ({
      query: k.query,
      topic: k.topic
        ? { mid: k.topic.mid, title: k.topic.title, type: k.topic.type }
        : undefined,
      value: k.value ?? 0,
      formattedValue: k.formattedValue ?? "",
      link: k.link,
      hasData: k.hasData,
    });
    return {
      top: (lists[0]?.rankedKeyword ?? []).map(map),
      rising: (lists[1]?.rankedKeyword ?? []).map(map),
    };
  }

  private parseDailyTrends(parsed: any): DailyTrendItem[] {
    const days = parsed?.default?.trendingSearchesDays ?? [];
    const out: DailyTrendItem[] = [];
    for (const day of days) {
      for (const s of day.trendingSearches ?? []) {
        out.push({
          title: s.title?.query ?? "",
          formattedTraffic: s.formattedTraffic ?? "",
          traffic:
            Number(String(s.formattedTraffic ?? "").replace(/[^\d]/g, "")) || 0,
          relatedQueries: (s.relatedQueries ?? []).map((q: any) => q.query),
          shareUrl: s.shareUrl,
          articles: (s.articles ?? []).map((a: any) => ({
            title: a.title ?? "",
            url: a.url ?? "",
            source: a.source,
            snippet: a.snippet,
          })),
        });
      }
    }
    return out;
  }
}
