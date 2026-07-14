import { createHash } from 'crypto';
import {
  SemanticSearchLike,
  TopicMetadata,
  SearchResult,
  EmbeddingClientLike,
  TopicDocument
} from './semanticSearch.types.js';
import { GoogleEmbeddingClient } from './embedding.client.js';
import { LanceRepositoryLike } from '../storage/storage.interfaces.js';
import { LanceRepository } from '../storage/lance/lance.repository.js';

export class SemanticSearchService implements SemanticSearchLike {
  private readonly embeddingClient: EmbeddingClientLike;
  private readonly vectorStore: LanceRepositoryLike;

  constructor(
    embeddingClient?: EmbeddingClientLike,
    vectorStore?: LanceRepositoryLike
  ) {
    this.embeddingClient = embeddingClient || new GoogleEmbeddingClient();
    this.vectorStore = vectorStore || new LanceRepository();
  }

  /**
   * Generates a SHA-256 hash for a given text.
   * Text is lowercased and trimmed to ensure consistent hashing for identical topics.
   */
  private generateId(text: string): string {
    const normalizedText = text.trim().toLowerCase();
    return createHash('sha256').update(normalizedText).digest('hex');
  }

  async indexTopics(topics: { text: string; metadata?: Partial<TopicMetadata> }[]): Promise<void> {
    if (topics.length === 0) return;

    await this.vectorStore.initialize();

    // 1. Generate IDs and Deduplicate within the batch itself
    const uniqueTopicsMap = new Map<string, TopicDocument>();
    for (const topic of topics) {
      if (!topic.text.trim()) continue; // Skip empty text

      const id = this.generateId(topic.text);
      if (!uniqueTopicsMap.has(id)) {
        uniqueTopicsMap.set(id, {
          id,
          text: topic.text,
          metadata: topic.metadata as TopicMetadata | undefined
        });
      }
    }

    const uniqueDocuments = Array.from(uniqueTopicsMap.values());
    if (uniqueDocuments.length === 0) return;

    const uniqueIds = uniqueDocuments.map(doc => doc.id);

    // 2. Check which ones already exist in the vector store
    const existingIds = await this.vectorStore.getExistingTopicIds(uniqueIds);
    const existingIdsSet = new Set(existingIds);

    // 3. Filter out the ones that are already stored
    const docsToEmbed = uniqueDocuments.filter(doc => !existingIdsSet.has(doc.id));

    if (docsToEmbed.length === 0) {
      console.log(`[SemanticSearch] All ${uniqueDocuments.length} topics already exist. Skipping embedding.`);
      return;
    }

    console.log(`[SemanticSearch] Embedding ${docsToEmbed.length} new topics (skipped ${existingIds.length} existing).`);

    // 4. Generate embeddings for the new topics
    const textsToEmbed = docsToEmbed.map(doc => doc.text);
    const embeddings = await this.embeddingClient.embed(textsToEmbed, false);

    // 5. Upsert to the vector store
    await this.vectorStore.upsertTopicVectors(docsToEmbed, embeddings);
    console.log(`[SemanticSearch] Successfully indexed ${docsToEmbed.length} topics.`);
  }

  async searchTopics(query: string, topK: number = 5): Promise<SearchResult[]> {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];

    await this.vectorStore.initialize();

    // 1. Generate hash for the query
    const queryId = this.generateId(trimmedQuery);

    // 2. Try to get existing embedding
    let queryEmbedding: number[] | null = null;

    if (this.vectorStore.getTopicEmbeddingById) {
      queryEmbedding = await this.vectorStore.getTopicEmbeddingById(queryId);
    }

    // 3. If not found, embed the search query
    if (!queryEmbedding) {
      const queryEmbeddings = await this.embeddingClient.embed([trimmedQuery], true);
      if (!queryEmbeddings || queryEmbeddings.length === 0) {
        return [];
      }
      queryEmbedding = queryEmbeddings[0];
    }

    // 4. Query the vector store for nearest neighbors
    const results = await this.vectorStore.searchTopics(queryEmbedding, topK);

    return results;
  }
}
