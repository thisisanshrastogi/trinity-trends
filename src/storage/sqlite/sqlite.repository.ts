import { createHash, randomUUID } from 'crypto';
import { SqliteRepositoryLike, SqliteClientLike } from '../storage.interfaces.js';
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
  PythonResultRecord,
  SavePythonResultInput,
} from '../storage.types.js';
import { SqliteClient } from './sqlite.client.js';

/**
 * Concrete SQLite repository implementing all CRUD operations.
 * Uses synchronous better-sqlite3 under the hood.
 */
export class SqliteRepository implements SqliteRepositoryLike {
  private readonly client: SqliteClientLike;

  constructor(client?: SqliteClientLike) {
    this.client = client || new SqliteClient();
    this.client.initialize();
  }

  // ──────────────────────────────────────────
  //  Helpers
  // ──────────────────────────────────────────

  private generateTopicId(text: string): string {
    return createHash('sha256').update(text.trim().toLowerCase()).digest('hex');
  }

  private generatePlatformHash(platform: string, platformId: string): string {
    return createHash('sha256').update(`${platform}:${platformId}`).digest('hex');
  }

  private now(): number {
    return Date.now();
  }

  // ──────────────────────────────────────────
  //  Users
  // ──────────────────────────────────────────

  createUser(input: CreateUserInput): User {
    const id = randomUUID();
    const createdAt = this.now();

    this.client.run(
      `INSERT INTO users (id, name, email, created_at) VALUES (?, ?, ?, ?)`,
      id, input.name, input.email ?? null, createdAt,
    );

    return { id, name: input.name, email: input.email, createdAt };
  }

  getUserById(id: string): User | null {
    const row = this.client.get<any>(
      `SELECT id, name, email, created_at as createdAt FROM users WHERE id = ?`, id,
    );
    return row ?? null;
  }

  getUserByEmail(email: string): User | null {
    const row = this.client.get<any>(
      `SELECT id, name, email, created_at as createdAt FROM users WHERE email = ?`, email,
    );
    return row ?? null;
  }

  // ──────────────────────────────────────────
  //  Sessions
  // ──────────────────────────────────────────

  createSession(input: CreateSessionInput): Session {
    const id = randomUUID();
    const createdAt = this.now();

    this.client.run(
      `INSERT INTO sessions (id, user_id, query, created_at) VALUES (?, ?, ?, ?)`,
      id, input.userId, input.query, createdAt,
    );

    return { id, userId: input.userId, query: input.query, createdAt };
  }

  getSessionById(id: string): Session | null {
    const row = this.client.get<any>(
      `SELECT id, user_id as userId, query, created_at as createdAt, completed_at as completedAt
       FROM sessions WHERE id = ?`, id,
    );
    return row ?? null;
  }

  getSessionsByUser(userId: string): Session[] {
    return this.client.all<any>(
      `SELECT id, user_id as userId, query, created_at as createdAt, completed_at as completedAt
       FROM sessions WHERE user_id = ? ORDER BY created_at DESC`, userId,
    );
  }

  completeSession(id: string): void {
    this.client.run(
      `UPDATE sessions SET completed_at = ? WHERE id = ?`,
      this.now(), id,
    );
  }

  deleteSession(id: string): void {
    this.client.run(`DELETE FROM sessions WHERE id = ?`, id);
  }

  // ──────────────────────────────────────────
  //  Topics
  // ──────────────────────────────────────────

  upsertTopic(input: UpsertTopicInput): Topic {
    const id = this.generateTopicId(input.text);
    const createdAt = this.now();

    // INSERT OR IGNORE — if the same topic text already exists, skip
    this.client.run(
      `INSERT OR IGNORE INTO topics (id, text, session_id, source, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      id, input.text, input.sessionId, input.source, createdAt,
    );

    // Always return the existing or newly created row
    return this.getTopicById(id)!;
  }

  getTopicById(id: string): Topic | null {
    const row = this.client.get<any>(
      `SELECT id, text, session_id as sessionId, source, created_at as createdAt
       FROM topics WHERE id = ?`, id,
    );
    return row ?? null;
  }

  getTopicsBySession(sessionId: string): Topic[] {
    return this.client.all<any>(
      `SELECT id, text, session_id as sessionId, source, created_at as createdAt
       FROM topics WHERE session_id = ? ORDER BY created_at ASC`, sessionId,
    );
  }

  addPlatformId(topicId: string, platform: Platform, platformId: string): void {
    const hashedId = this.generatePlatformHash(platform, platformId);

    this.client.run(
      `INSERT OR IGNORE INTO topic_platform_ids (topic_id, platform, platform_id, hashed_id)
       VALUES (?, ?, ?, ?)`,
      topicId, platform, platformId, hashedId,
    );
  }

  getPlatformIds(topicId: string): TopicPlatformId[] {
    return this.client.all<any>(
      `SELECT topic_id as topicId, platform, platform_id as platformId, hashed_id as hashedId
       FROM topic_platform_ids WHERE topic_id = ?`, topicId,
    );
  }

  getTopicByPlatformId(platform: Platform, platformId: string): Topic | null {
    const hashedId = this.generatePlatformHash(platform, platformId);

    const row = this.client.get<any>(
      `SELECT t.id, t.text, t.session_id as sessionId, t.source, t.created_at as createdAt
       FROM topics t
       JOIN topic_platform_ids tp ON t.id = tp.topic_id
       WHERE tp.hashed_id = ?`, hashedId,
    );
    return row ?? null;
  }

  // ──────────────────────────────────────────
  //  Pipeline Runs
  // ──────────────────────────────────────────

  createPipelineRun(input: CreatePipelineRunInput): PipelineRun {
    const id = randomUUID();
    const startedAt = this.now();

    this.client.run(
      `INSERT INTO pipeline_runs (id, session_id, stage, status, started_at)
       VALUES (?, ?, ?, 'running', ?)`,
      id, input.sessionId, input.stage, startedAt,
    );

    return {
      id,
      sessionId: input.sessionId,
      stage: input.stage,
      status: 'running',
      startedAt,
    };
  }

  updatePipelineRun(id: string, updates: UpdatePipelineRunInput): void {
    const setClauses: string[] = [];
    const params: any[] = [];

    if (updates.status !== undefined) {
      setClauses.push('status = ?');
      params.push(updates.status);
    }
    if (updates.completedAt !== undefined) {
      setClauses.push('completed_at = ?');
      params.push(updates.completedAt);
    }
    if (updates.error !== undefined) {
      setClauses.push('error = ?');
      params.push(updates.error);
    }
    if (updates.resultSummary !== undefined) {
      setClauses.push('result_summary = ?');
      params.push(updates.resultSummary);
    }

    if (setClauses.length === 0) return;

    params.push(id);
    this.client.run(
      `UPDATE pipeline_runs SET ${setClauses.join(', ')} WHERE id = ?`,
      ...params,
    );
  }

  getPipelineRunsBySession(sessionId: string): PipelineRun[] {
    return this.client.all<any>(
      `SELECT id, session_id as sessionId, stage, status,
              started_at as startedAt, completed_at as completedAt,
              error, result_summary as resultSummary
       FROM pipeline_runs WHERE session_id = ? ORDER BY started_at ASC`, sessionId,
    );
  }

  // ──────────────────────────────────────────
  //  Intent Results
  // ──────────────────────────────────────────

  saveIntentResult(input: SaveIntentResultInput): IntentResultRecord {
    const id = randomUUID();
    const createdAt = this.now();

    this.client.run(
      `INSERT OR REPLACE INTO intent_results (id, session_id, query, result_json, created_at)
       VALUES (?, ?, ?, ?, ?)`,
      id, input.sessionId, input.query, input.resultJson, createdAt,
    );

    return { id, sessionId: input.sessionId, query: input.query, resultJson: input.resultJson, createdAt };
  }

  getIntentResult(sessionId: string): IntentResultRecord | null {
    const row = this.client.get<any>(
      `SELECT id, session_id as sessionId, query, result_json as resultJson, created_at as createdAt
       FROM intent_results WHERE session_id = ?`, sessionId,
    );
    return row ?? null;
  }

  // ──────────────────────────────────────────
  //  Expansion Results
  // ──────────────────────────────────────────

  saveExpansionResult(input: SaveExpansionResultInput): ExpansionResultRecord {
    const id = randomUUID();
    const createdAt = this.now();

    this.client.run(
      `INSERT OR REPLACE INTO expansion_results (id, session_id, seed, result_json, candidate_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      id, input.sessionId, input.seed, input.resultJson, input.candidateCount, createdAt,
    );

    return {
      id,
      sessionId: input.sessionId,
      seed: input.seed,
      resultJson: input.resultJson,
      candidateCount: input.candidateCount,
      createdAt,
    };
  }

  getExpansionResult(sessionId: string): ExpansionResultRecord | null {
    const row = this.client.get<any>(
      `SELECT id, session_id as sessionId, seed, result_json as resultJson,
              candidate_count as candidateCount, created_at as createdAt
       FROM expansion_results WHERE session_id = ?`, sessionId,
    );
    return row ?? null;
  }

  // ──────────────────────────────────────────
  //  Collector Results
  // ──────────────────────────────────────────

  saveCollectorResult(input: SaveCollectorResultInput): CollectorResultRecord {
    const id = randomUUID();
    const collectedAt = this.now();

    this.client.run(
      `INSERT INTO collector_results (id, topic_id, session_id, platform, query, result_json, result_count, collected_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, input.topicId, input.sessionId, input.platform, input.query, input.resultJson, input.resultCount, collectedAt,
    );

    return {
      id,
      topicId: input.topicId,
      sessionId: input.sessionId,
      platform: input.platform,
      query: input.query,
      resultJson: input.resultJson,
      resultCount: input.resultCount,
      collectedAt,
    };
  }

  getCollectorResults(topicId: string, sessionId: string): CollectorResultRecord[] {
    return this.client.all<any>(
      `SELECT id, topic_id as topicId, session_id as sessionId, platform,
              query, result_json as resultJson, result_count as resultCount,
              collected_at as collectedAt
       FROM collector_results WHERE topic_id = ? AND session_id = ?
       ORDER BY collected_at ASC`, topicId, sessionId,
    );
  }

  getCollectorResultsBySession(sessionId: string): CollectorResultRecord[] {
    return this.client.all<any>(
      `SELECT id, topic_id as topicId, session_id as sessionId, platform,
              query, result_json as resultJson, result_count as resultCount,
              collected_at as collectedAt
       FROM collector_results WHERE session_id = ?
       ORDER BY collected_at ASC`, sessionId,
    );
  }

  getCollectorResultsByPlatform(sessionId: string, platform: Platform): CollectorResultRecord[] {
    return this.client.all<any>(
      `SELECT id, topic_id as topicId, session_id as sessionId, platform,
              query, result_json as resultJson, result_count as resultCount,
              collected_at as collectedAt
       FROM collector_results WHERE session_id = ? AND platform = ?
       ORDER BY collected_at ASC`, sessionId, platform,
    );
  }

  // ──────────────────────────────────────────
  //  Python Results
  // ──────────────────────────────────────────

  savePythonResult(input: SavePythonResultInput): PythonResultRecord {
    const id = randomUUID();
    const createdAt = this.now();

    this.client.run(
      `INSERT OR REPLACE INTO python_results (id, session_id, result_json, created_at)
       VALUES (?, ?, ?, ?)`,
      id, input.sessionId, input.resultJson, createdAt,
    );

    return { id, sessionId: input.sessionId, resultJson: input.resultJson, createdAt };
  }

  getPythonResult(sessionId: string): PythonResultRecord | null {
    const row = this.client.get<any>(
      `SELECT id, session_id as sessionId, result_json as resultJson, created_at as createdAt
       FROM python_results WHERE session_id = ?`, sessionId,
    );
    return row ?? null;
  }

  // ──────────────────────────────────────────
  //  Token Usage
  // ──────────────────────────────────────────

  saveTokenUsage(
    sessionId: string,
    stage: string,
    model: string,
    promptTokens: number,
    outputTokens: number,
    totalTokens: number
  ): void {
    const id = randomUUID();
    const createdAt = this.now();
    this.client.run(
      `INSERT INTO token_usage (id, session_id, stage, model, prompt_tokens, output_tokens, total_tokens, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      id, sessionId, stage, model, promptTokens, outputTokens, totalTokens, createdAt
    );
  }

  getTokenUsageBySession(sessionId: string): any[] {
    return this.client.all<any>(
      `SELECT id, session_id as sessionId, stage, model, prompt_tokens as promptTokens, output_tokens as outputTokens, total_tokens as totalTokens, created_at as createdAt
       FROM token_usage WHERE session_id = ?
       ORDER BY created_at ASC`, sessionId
    );
  }

  // ──────────────────────────────────────────
  //  Transcripts
  // ──────────────────────────────────────────

  saveTranscript(url: string, transcript: string): string {
    const id = randomUUID();
    const createdAt = this.now();
    this.client.run(
      `INSERT INTO transcripts (id, url, transcript, created_at) VALUES (?, ?, ?, ?)`,
      id, url, transcript, createdAt
    );
    return id;
  }

  getTranscripts(): { id: string; url: string; transcript: string; created_at: number }[] {
    return this.client.all(
      `SELECT id, url, transcript, created_at FROM transcripts ORDER BY created_at DESC`
    );
  }
}
