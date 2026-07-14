export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMCallOptions {
  json?: boolean;
  // JSON schema (Gemini responseSchema) — when set, output is guaranteed
  // to be valid JSON matching it. Implies json: true.
  schema?: Record<string, unknown>;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMCaller {
  complete(messages: LLMMessage[], options?: LLMCallOptions): Promise<string>;
}

export interface LLMFactory {
  get(purpose: string): LLMCaller;
}
