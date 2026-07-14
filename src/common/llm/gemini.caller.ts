import { GoogleGenAI } from "@google/genai";
import { LLMCaller, LLMCallOptions, LLMMessage } from "./llm.types.js";
import { Tracer, traced } from "./llm.trace.js";

export interface GeminiCallerConfig {
  ai: GoogleGenAI;
  model: string;
  defaultTemperature?: number;
  defaultMaxTokens?: number;
  timeoutMs?: number;
  tracer?: Tracer;
  scope?: string; // e.g. "gemini:intent"
}

const DEFAULT_TIMEOUT_MS = 30000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`gemini timeout after ${ms}ms`)), ms),
    ),
  ]);
}

export class GeminiCaller implements LLMCaller {
  constructor(private readonly cfg: GeminiCallerConfig) {}

  async complete(
    messages: LLMMessage[],
    options: LLMCallOptions = {},
  ): Promise<string> {
    const systemText = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n\n");

    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      }));

    const config: Record<string, unknown> = {
      temperature: options.temperature ?? this.cfg.defaultTemperature ?? 0.7,
      maxOutputTokens: options.maxTokens ?? this.cfg.defaultMaxTokens ?? 1024,
      // gemini-2.5-flash has thinking ON by default; thinking tokens are billed
      // against maxOutputTokens and truncate/stall the JSON. Disable for these
      // structured extraction calls. (Ignored by 3.x models, which can't disable it.)
      thinkingConfig: { thinkingBudget: 0 },
    };

    if (systemText) config["systemInstruction"] = systemText;

    if (options.schema) {
      config["responseMimeType"] = "application/json";
      config["responseSchema"] = options.schema;
    } else if (options.json) {
      config["responseMimeType"] = "application/json";
    }

    const scope = this.cfg.scope ?? "gemini";
    const timeoutMs = this.cfg.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const response = await traced(
      this.cfg.tracer,
      scope,
      () =>
        withTimeout(
          this.cfg.ai.models.generateContent({
            model: this.cfg.model,
            contents,
            config,
          }),
          timeoutMs,
        ),
      (r) => ({
        model: this.cfg.model,
        chars: (r.text ?? "").length,
        finishReason: r.candidates?.[0]?.finishReason,
      }),
      (r) => ({
        text: r.text ?? "",
        finishReason: r.candidates?.[0]?.finishReason,
        usage: r.usageMetadata,
      }),
    );

    // surface truncation explicitly — if this ever fires, raise maxTokens
    const finish = response.candidates?.[0]?.finishReason;
    if (finish && finish !== "STOP") {
      this.cfg.tracer?.event({
        scope,
        phase: "error",
        detail: { finishReason: finish, chars: (response.text ?? "").length },
      });
    }

    return response.text ?? "";
  }
}
