import { LanceRepositoryLike } from '../storage.interfaces.js';
import { TopicDocument, SearchResult } from '../../semantic/semanticSearch.types.js';
import { ContentDocument, ContentSearchResult } from '../storage.types.js';
import { LanceClient } from './lance.client.js';

const TOPICS_TABLE = 'topics';
const CONTENT_TABLE = 'content';

// ── Input Sanitization ──────────────────────────────
// LanceDB uses DataFusion SQL-like filters that don't support
// bind parameters. We must sanitize any value interpolated into
// filter strings to prevent injection attacks.

/** Hex-only regex — matches SHA-256 hashes and UUIDs (after dash removal). */
const SAFE_ID_PATTERN = /^[a-fA-F0-9-]+$/;

/**
 * Escapes a string value for safe interpolation into a DataFusion
 * SQL filter. Doubles single quotes and validates against injection
 * patterns.
 */
function escapeFilterValue(value: string): string {
  // Reject obviously malicious payloads (semicolons, comments, etc.)
  if (/[;\\]|--|\/\*/.test(value)) {
    throw new Error(`[LanceRepository] Potentially malicious filter value rejected: "${value}"`);
  }
  // Escape single quotes by doubling them (SQL standard)
  return value.replace(/'/g, "''");
}

/**
 * Validates that an ID is a safe hex string (SHA-256 hash or UUID).
 * Throws if the value contains unexpected characters.
 */
function assertSafeId(id: string): void {
  if (!SAFE_ID_PATTERN.test(id)) {
    throw new Error(`[LanceRepository] Invalid ID format — expected hex hash, got: "${id}"`);
  }
}

/**
 * LanceDB repository managing two vector collections:
 *  - `topics`  — topic embeddings for semantic search
 *  - `content` — title + description embeddings for content similarity
 */
export class LanceRepository implements LanceRepositoryLike {
  private readonly client: LanceClient;

  constructor(client?: LanceClient) {
    this.client = client || new LanceClient();
  }

  async initialize(): Promise<void> {
    await this.client.connect();
    console.log('[LanceRepository] Initialized.');
  }

  // ──────────────────────────────────────────
  //  Topic Vectors
  // ──────────────────────────────────────────

  async upsertTopicVectors(documents: TopicDocument[], embeddings: number[][]): Promise<void> {
    if (documents.length === 0) return;
    if (documents.length !== embeddings.length) {
      throw new Error('[LanceRepository] Mismatched documents and embeddings length for topics.');
    }

    const data = documents.map((doc, idx) => ({
      id: doc.id,
      vector: embeddings[idx],
      text: doc.text,
      metadata: doc.metadata ? JSON.stringify(doc.metadata) : null,
    }));

    await this.client.addToTable(TOPICS_TABLE, data);
  }

  async searchTopics(queryEmbedding: number[], topK: number): Promise<SearchResult[]> {
    const results = await this.client.vectorSearch(TOPICS_TABLE, queryEmbedding, topK, 'cosine');

    return results.map((r: any) => {
      const similarityScore = r._distance !== undefined ? 1 - r._distance : 1;
      return {
        document: {
          id: r.id,
          text: r.text,
          metadata: r.metadata ? JSON.parse(r.metadata) : undefined,
        },
        similarityScore,
      };
    });
  }

  async getExistingTopicIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];

    ids.forEach(assertSafeId);
    const idList = ids.map(id => `'${escapeFilterValue(id)}'`).join(', ');
    const results = await this.client.filter(TOPICS_TABLE, `id IN (${idList})`, ['id']);
    return results.map((r: any) => r.id);
  }

  async getTopicEmbeddingById(id: string): Promise<number[] | null> {
    assertSafeId(id);
    const results = await this.client.filter(TOPICS_TABLE, `id = '${escapeFilterValue(id)}'`, ['vector']);
    if (results.length > 0) {
      return Array.from(results[0].vector);
    }
    return null;
  }

  // ──────────────────────────────────────────
  //  Content Vectors (title:description)
  // ──────────────────────────────────────────

  async upsertContentVectors(documents: ContentDocument[], embeddings: number[][]): Promise<void> {
    if (documents.length === 0) return;
    if (documents.length !== embeddings.length) {
      throw new Error('[LanceRepository] Mismatched documents and embeddings length for content.');
    }

    const data = documents.map((doc, idx) => ({
      id: doc.id,
      vector: embeddings[idx],
      title: doc.title,
      description: doc.description,
      platform: doc.platform,
      source_url: doc.sourceUrl || null,
      metadata: doc.metadata || null,
    }));

    await this.client.addToTable(CONTENT_TABLE, data);
  }

  async searchContent(queryEmbedding: number[], topK: number): Promise<ContentSearchResult[]> {
    const results = await this.client.vectorSearch(CONTENT_TABLE, queryEmbedding, topK, 'cosine');

    return results.map((r: any) => {
      const similarityScore = r._distance !== undefined ? 1 - r._distance : 1;
      return {
        document: {
          id: r.id,
          title: r.title,
          description: r.description,
          platform: r.platform,
          sourceUrl: r.source_url || undefined,
          metadata: r.metadata || undefined,
        },
        similarityScore,
      };
    });
  }

  async getExistingContentIds(ids: string[]): Promise<string[]> {
    if (ids.length === 0) return [];

    ids.forEach(assertSafeId);
    const idList = ids.map(id => `'${escapeFilterValue(id)}'`).join(', ');
    const results = await this.client.filter(CONTENT_TABLE, `id IN (${idList})`, ['id']);
    return results.map((r: any) => r.id);
  }
}
