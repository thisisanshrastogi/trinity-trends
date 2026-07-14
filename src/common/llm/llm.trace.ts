export interface TraceEvent {
  scope: string; // "gemini:intent", "trends", "autocomplete", "llm:expansion"
  phase: "start" | "ok" | "error";
  ms?: number;
  detail?: unknown;
  raw?: unknown;
}

export interface Tracer {
  event(e: TraceEvent): void;
}

export class ConsoleTracer implements Tracer {
  constructor(private readonly verbose = true) {}

  event(e: TraceEvent): void {
    if (!this.verbose) return;
    const tag = `[${e.scope}] ${e.phase}`;
    const ms = e.ms != null ? ` (${e.ms.toFixed(0)}ms)` : "";
    if (e.phase === "error") {
      console.error(`${tag}${ms}:`, e.detail);
    } else {
      console.log(`${tag}${ms}`, e.detail ?? "");
    }
    // note: e.raw is intentionally not printed — it goes to the file recorder
  }
}

// helper: time an async call and emit start/ok/error
export async function traced<T>(
  tracer: Tracer | undefined,
  scope: string,
  fn: () => Promise<T>,
  summarise?: (result: T) => unknown,
  capture?: (result: T) => unknown, // full body for the file
): Promise<T> {
  tracer?.event({ scope, phase: "start" });
  const t0 = Date.now();
  try {
    const result = await fn();
    tracer?.event({
      scope,
      phase: "ok",
      ms: Date.now() - t0,
      detail: summarise ? summarise(result) : undefined,
      raw: capture ? capture(result) : undefined,
    });
    return result;
  } catch (err) {
    tracer?.event({
      scope,
      phase: "error",
      ms: Date.now() - t0,
      detail: err instanceof Error ? err.message : err,
    });
    throw err;
  }
}
