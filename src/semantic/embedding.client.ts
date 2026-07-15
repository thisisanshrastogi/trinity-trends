import { GoogleGenAI } from '@google/genai';
import { EmbeddingClientLike } from './semanticSearch.types.js';
import { loadGlobalEnv } from '../utils/env.js';

loadGlobalEnv();

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
        // We limit concurrency to prevent ECONNRESET on Windows, but run full batch on Linux/Mac
        const concurrencyLimit = process.platform === 'win32' ? 5 : this.batchSize;
        for (let j = 0; j < batch.length; j += concurrencyLimit) {
          const subBatch = batch.slice(j, j + concurrencyLimit);
          
          const embeddingsPromises = subBatch.map(async text => {
            // Add retry logic with exponential backoff
            const maxRetries = 3;
            for (let attempt = 0; attempt < maxRetries; attempt++) {
              try {
                const response = await this.ai.models.embedContent({
                  model: this.model,
                  contents: text,
                  config: { taskType: taskType }
                });
                return response;
              } catch (err: any) {
                if (attempt === maxRetries - 1) throw err;
                const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 1000, 10000);
                await new Promise(resolve => setTimeout(resolve, delay));
              }
            }
            throw new Error('Unreachable');
          });

          const responses = await Promise.all(embeddingsPromises);

          for (const response of responses) {
            if (response && response.embeddings && response.embeddings.length > 0) {
              allEmbeddings.push(response.embeddings[0].values || []);
            } else {
              allEmbeddings.push([]);
            }
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
