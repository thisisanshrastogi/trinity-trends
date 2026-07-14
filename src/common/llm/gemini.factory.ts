import { GoogleGenAI } from "@google/genai";
import { LLMCaller, LLMFactory } from "./llm.types.js";
import { GeminiCaller } from "./gemini.caller.js";
import { Tracer } from "./llm.trace.js";

// Ensure environment variables are loaded (especially when running tests directly)
try {
  process.loadEnvFile();
} catch (e) {
  // Ignore if .env doesn't exist
}

export interface GeminiFactoryConfig {
  apiKey?: string;
  models?: Record<string, { model?: string; temperature?: number }>;
  tracer?: Tracer;
}

const DEFAULTS = { model: "gemini-3.1-flash-lite", temperature: 0.7 };
const PURPOSE_DEFAULTS: Record<
  string,
  { model?: string; temperature?: number }
> = {
  intent: { temperature: 0 },
  expansion: { temperature: 0.4 },
};

export class GeminiFactory implements LLMFactory {
  private readonly ai: GoogleGenAI;
  private readonly cache = new Map<string, LLMCaller>();

  constructor(private readonly cfg: GeminiFactoryConfig = {}) {
    this.ai = new GoogleGenAI({ 
      apiKey: cfg.apiKey || process.env.GEMINI_API_KEY 
    });
  }

  get(purpose: string): LLMCaller {
    const cached = this.cache.get(purpose);
    if (cached) return cached;

    const override = this.cfg.models?.[purpose] ?? {};
    const purposeDefault = PURPOSE_DEFAULTS[purpose] ?? {};

    const caller = new GeminiCaller({
      ai: this.ai,
      model: override.model ?? purposeDefault.model ?? DEFAULTS.model,
      defaultTemperature:
        override.temperature ??
        purposeDefault.temperature ??
        DEFAULTS.temperature,
      tracer: this.cfg.tracer,
      scope: `gemini:${purpose}`,
    });

    this.cache.set(purpose, caller);
    return caller;
  }
}
