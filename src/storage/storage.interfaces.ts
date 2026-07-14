import type {
  User,
  CreateUserInput,
  Session,
  CreateSessionInput,
  Topic,
  UpsertTopicInput,
  TopicPlatformId,
  PipelineRun,
  CreatePipelineRunInput,
  UpdatePipelineRunInput,
  CollectorResultRecord,
  SaveCollectorResultInput,
  ExpansionResultRecord,
  SaveExpansionResultInput,
  IntentResultRecord,
  SaveIntentResultInput,
  Platform,
  ContentDocument,
  ContentSearchResult,
  ContentDocumentInput,
  PythonResultRecord,
  SavePythonResultInput,
} from './storage.types.js';

import type { TopicDocument, SearchResult } from '../semantic/semanticSearch.types.js';

// ──────────────────────────────────────────────
//  SQLite Client Interface
// ──────────────────────────────────────────────

export interface SqliteClientLike {
  /** Open the database and run migrations. */
  initialize(): void;

  /** Execute a write statement (INSERT, UPDATE, DELETE). Returns { changes, lastInsertRowid }. */
  run(sql: string, ...params: any[]): { changes: number; lastInsertRowid: number | bigint };

  /** Query a single row. */
  get<T = any>(sql: string, ...params: any[]): T | undefined;

  /** Query multiple rows. */
  all<T = any>(sql: string, ...params: any[]): T[];

  /** Close the database connection. */
  close(): void;
}

// ──────────────────────────────────────────────
//  SQLite Repository Interface
// ──────────────────────────────────────────────

export interface SqliteRepositoryLike {
  // ── Users ──────────────────────────────────
  createUser(input: CreateUserInput): User;
  getUserById(id: string): User | null;
  getUserByEmail(email: string): User | null;

  // ── Sessions ───────────────────────────────
  createSession(input: CreateSessionInput): Session;
  getSessionById(id: string): Session | null;
  getSessionsByUser(userId: string): Session[];
  completeSession(id: string): void;

  // ── Topics ─────────────────────────────────
  upsertTopic(input: UpsertTopicInput): Topic;
  getTopicById(id: string): Topic | null;
  getTopicsBySession(sessionId: string): Topic[];
  addPlatformId(topicId: string, platform: Platform, platformId: string): void;
  getPlatformIds(topicId: string): TopicPlatformId[];
  getTopicByPlatformId(platform: Platform, platformId: string): Topic | null;

  // ── Pipeline Runs ──────────────────────────
  createPipelineRun(input: CreatePipelineRunInput): PipelineRun;
  updatePipelineRun(id: string, updates: UpdatePipelineRunInput): void;
  getPipelineRunsBySession(sessionId: string): PipelineRun[];

  // ── Intent Results ─────────────────────────
  saveIntentResult(input: SaveIntentResultInput): IntentResultRecord;
  getIntentResult(sessionId: string): IntentResultRecord | null;

  // ── Expansion Results ──────────────────────
  saveExpansionResult(input: SaveExpansionResultInput): ExpansionResultRecord;
  getExpansionResult(sessionId: string): ExpansionResultRecord | null;

  // ── Collector Results ──────────────────────
  saveCollectorResult(input: SaveCollectorResultInput): CollectorResultRecord;
  getCollectorResults(topicId: string, sessionId: string): CollectorResultRecord[];
  getCollectorResultsBySession(sessionId: string): CollectorResultRecord[];
  getCollectorResultsByPlatform(sessionId: string, platform: Platform): CollectorResultRecord[];

  // ── Python Results ─────────────────────────
  savePythonResult(input: SavePythonResultInput): PythonResultRecord;
  getPythonResult(sessionId: string): PythonResultRecord | null;
}

// ──────────────────────────────────────────────
//  LanceDB Repository Interface
// ──────────────────────────────────────────────

export interface LanceRepositoryLike {
  /** Initialize connections for all managed tables. */
  initialize(): Promise<void>;

  // ── Topic Vectors (semantic search on topics) ──
  upsertTopicVectors(documents: TopicDocument[], embeddings: number[][]): Promise<void>;
  searchTopics(queryEmbedding: number[], topK: number): Promise<SearchResult[]>;
  getExistingTopicIds(ids: string[]): Promise<string[]>;
  getTopicEmbeddingById(id: string): Promise<number[] | null>;

  // ── Content Vectors (title:description similarity) ──
  upsertContentVectors(documents: ContentDocument[], embeddings: number[][]): Promise<void>;
  searchContent(queryEmbedding: number[], topK: number): Promise<ContentSearchResult[]>;
  getExistingContentIds(ids: string[]): Promise<string[]>;
}
