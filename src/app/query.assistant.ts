import { GeminiFactory } from '../common/llm/gemini.factory.js';

export class QueryAssistant {
  private llm = new GeminiFactory().get('query-expansion');

  async generateQuestions(baseTopic: string): Promise<string[]> {
    if (!baseTopic.trim()) return [];

    const currentYear = new Date().getFullYear();
    const currentDate = new Date().toLocaleDateString();

    const prompt = `You are a search query generation assistant for a trend analysis tool with access to live web search.
Use web search to find what's currently trending, recently changed, or actively being discussed around "${baseTopic}" — specific products, launches, debates, or shifts happening right now, not just general knowledge about the topic.

Based on what you find, generate 5 highly specific, insightful, and searchable queries that would yield excellent trend data.

Rules:
- Favor queries tied to named entities, events, or recent developments over generic restatements of the topic.
- Do not mechanically append the current year or month to every query. Only include a date/time reference when the query is specifically about a dated event (an election, a policy deadline, an earnings report) — not as a generic freshness signal.
- Vary the phrasing and structure across the 5 queries. Avoid producing near-duplicate queries that differ only by which recency word or which entity is swapped in.
- Each query should be something a person would plausibly type into a search engine, not a headline.

Topic: "${baseTopic}"
Provide the output as a JSON array of 5 strings.`;
    try {
      const raw = await this.llm.complete([{ role: 'user', content: prompt }], {
        temperature: 0.7,
        maxTokens: 2048,
        schema: {
          type: "array",
          items: { type: "string" },
          maxItems: 5,
          minItems: 1
        }
      });
      return JSON.parse(raw);
    } catch (err) {
      // Fallback if LLM fails
      return [
        `${baseTopic} trends`,
        `${baseTopic} alternatives`,
        `how to use ${baseTopic}`
      ];
    }
  }
}
