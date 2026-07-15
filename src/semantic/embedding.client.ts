import { GoogleGenAI } from '@google/genai';
import { EmbeddingClientLike } from './semanticSearch.types.js';

try {
  process.loadEnvFile();
} catch (e) {
  // Ignore
}

export class GoogleEmbeddingClient implements EmbeddingClientLike {
  private readonly ai: GoogleGenAI;
  private readonly model: string;
  private readonly batchSize: number;

  constructor(
    apiKey?: string,
    model: string = 'gemini-embedding-2',
    batchSize: number = 50
  ) {
    // If apiKey is not provided, the SDK will automatically pick it up from process.env.GEMINI_API_KEY
    this.ai = new GoogleGenAI({ apiKey: apiKey || process.env.GEMINI_API_KEY });
    this.model = model;
    this.batchSize = batchSize;
  }

  async embed(texts: string[], isQuery: boolean = false): Promise<number[][]> {
    if (texts.length === 0) return [];

    const taskType = isQuery ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT';
    const allEmbeddings: number[][] = [];

    // Process in batches to avoid payload limits
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);

      try {
        // The response.embeddings should map 1-to-1 with the batch array
        const embeddingsPromises = batch.map(text =>
          this.ai.models.embedContent({
            model: this.model,
            contents: text,
            config: {
              taskType: taskType,
            }
          })
        );
        const responses = await Promise.all(embeddingsPromises);

        for (const response of responses) {
          if (response.embeddings && response.embeddings.length > 0) {
            allEmbeddings.push(response.embeddings[0].values || []);
          } else {
            allEmbeddings.push([]);
          }
        }
      } catch (error) {
        console.error(`Failed to embed batch ${i} to ${i + batch.length}:`, error);
        throw error; // Let the orchestrator handle or fail
      }
    }

    return allEmbeddings;
  }
}
