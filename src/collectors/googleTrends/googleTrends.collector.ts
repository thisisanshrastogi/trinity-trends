import { GoogleTrendsClient } from "./googleTrends.client.js";
import { GoogleTrendsParser } from "./googleTrends.parser.js";
import { CollectorLike, ClientLike } from "../core/core.interfaces.js";
import {
  GoogleTrendsSearchRequest,
  GoogleTrendsCollectRequest,
  GoogleTrendsMethodResult,
  GoogleTrendsMethod,
} from "./googleTrends.types.js";

export interface GoogleTrendsParserLike {
  parse(method: GoogleTrendsMethod, raw: string): GoogleTrendsMethodResult;
}

const RETRY_ATTEMPTS = 4;
const BACKOFF_BASE_MS = 2000; // grows per attempt: 2s, 4s, 6s...
const METHOD_GAP_MS = 600; // pause between methods in a batch
const MIN_EXECUTION_TIME_MS = 5000; // minimum time the collect promise should take

export class GoogleTrendsCollector implements CollectorLike<
  GoogleTrendsCollectRequest,
  GoogleTrendsMethodResult[]
> {
  readonly id = "googleTrends";

  constructor(
    private readonly retryAttempts = RETRY_ATTEMPTS,
    private readonly backoffBaseMs = BACKOFF_BASE_MS,
    private readonly methodGapMs = METHOD_GAP_MS,
    private readonly minExecutionTimeMs = MIN_EXECUTION_TIME_MS,
    private readonly client: ClientLike<GoogleTrendsSearchRequest> = new GoogleTrendsClient(),
    private readonly parser: GoogleTrendsParserLike = new GoogleTrendsParser(),
  ) {}

  async collect(
    req: GoogleTrendsCollectRequest,
  ): Promise<GoogleTrendsMethodResult[]> {
    const startTime = Date.now();
    const keyword = req.keyword ?? (req.query != null ? [req.query] : []);
    const results: GoogleTrendsMethodResult[] = [];

    for (const method of req.methods) {
      const searchReq: GoogleTrendsSearchRequest = {
        method,
        keyword,
        geo: req.geo,
        hl: req.hl,
        timezone: req.timezone,
        category: req.category,
        startTime: req.startTime,
        endTime: req.endTime,
        resolution: req.resolution,
        trendDate: req.trendDate,
      };

      try {
        const raw = await this.searchWithRetry(searchReq);
        results.push(this.parser.parse(method, raw));
      } catch (err) {
        if (err instanceof Error && err.message.includes("Rate limit")) {
          throw err;
        }
        results.push({
          method,
          error: err instanceof Error ? err.message : "request failed",
        });
      }

      await this.sleep(this.methodGapMs);
    }

    const elapsedMs = Date.now() - startTime;
    if (elapsedMs < this.minExecutionTimeMs) {
      await this.sleep(this.minExecutionTimeMs - elapsedMs);
    }

    return results;
  }

  private async searchWithRetry(
    req: GoogleTrendsSearchRequest,
    attempts = RETRY_ATTEMPTS,
  ): Promise<string> {
    let raw = "";

    for (let i = 0; i < attempts; i++) {
      try {
        raw = await this.client.search(req);
      } catch (err) {
        // Network-level failures throw; retry the transient ones.
        const msg = err instanceof Error ? err.message : "";
        const transient = /EAI_AGAIN|ETIMEDOUT|ECONNRESET|ENOTFOUND/.test(msg);
        if (!transient || i === attempts - 1) throw err;
        await this.sleep(this.backoffBaseMs * (i + 1));
        continue;
      }

      // A 429 comes back as a RESOLVED HTML body, not a throw — inspect it.
      if (!this.isRateLimited(raw)) return raw;

      // Out of attempts: throw an error so it propagates.
      if (i === attempts - 1) {
        throw new Error(`Rate limit exceeded for method ${req.method} after ${attempts} attempts`);
      }

      await this.sleep(this.backoffBaseMs * (i + 1));
    }

    return raw;
  }

  private isRateLimited(raw: string): boolean {
    return /Error 429/i.test(raw.slice(0, 500));
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
