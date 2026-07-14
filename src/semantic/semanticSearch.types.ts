export interface TopicMetadata {
  id?: string;
  source?: string;
  createdAt?: number;
  [key: string]: any;
}

export interface TopicDocument {
  id: string; // SHA-256 hash of the normalized topic text
  text: string; // The raw topic or title
  metadata?: TopicMetadata;
}

export interface SearchResult {
  document: TopicDocument;
  similarityScore: number; // 0.0 to 1.0 (Cosine Similarity)
}

export interface EmbeddingClientLike {
  /**
   * Generates embeddings for a batch of strings.
   * @param texts An array of strings to embed.
   * @param isQuery True if embedding a search query, False if embedding a document for storage.
   * @returns A promise that resolves to an array of float arrays (embeddings).
   */
  embed(texts: string[], isQuery?: boolean): Promise<number[][]>;
}



export interface SemanticSearchLike {
  /**
   * Indexes a batch of topics into the semantic search system.
   * Handles deduplication (hashing) and embedding automatically.
   */
  indexTopics(
    topics: { text: string; metadata?: Partial<TopicMetadata> }[],
  ): Promise<void>;

  /**
   * Searches for similar topics.
   * @param query The search query string.
   * @param topK The max number of results to return.
   */
  searchTopics(query: string, topK?: number): Promise<SearchResult[]>;
}
