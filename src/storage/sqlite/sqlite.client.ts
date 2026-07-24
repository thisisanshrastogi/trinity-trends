import Database from 'better-sqlite3';
import path from 'path';
import { mkdirSync } from 'fs';
import { SqliteClientLike } from '../storage.interfaces.js';

import os from 'os';

const DEFAULT_DB_PATH = process.env.TRINITY_DATA_DIR 
  ? path.resolve(process.env.TRINITY_DATA_DIR, 'data', 'trinity_trends.db')
  : path.resolve(os.homedir(), '.trinity_trends', 'data', 'trinity_trends.db');

/**
 * Thin wrapper around better-sqlite3 that handles connection lifecycle
 * and schema migrations. All operations are synchronous (better-sqlite3
 * is a synchronous library, which keeps the repository layer simple).
 */
export class SqliteClient implements SqliteClientLike {
  private db: Database.Database | null = null;
  private readonly dbPath: string;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
  }

  // ──────────────────────────────────────────
  //  Lifecycle
  // ──────────────────────────────────────────

  initialize(): void {
    if (this.db) return;

    // Ensure the parent directory exists
    const dir = path.dirname(this.dbPath);
    mkdirSync(dir, { recursive: true });

    this.db = new Database(this.dbPath);

    // Performance pragmas
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');

    this.migrate();
    // console.log(`[SqliteClient] Database initialized at ${this.dbPath}`);
  }

  close(): void {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }

  // ──────────────────────────────────────────
  //  Query helpers
  // ──────────────────────────────────────────

  run(sql: string, ...params: any[]): { changes: number; lastInsertRowid: number | bigint } {
    this.ensureOpen();
    const stmt = this.db!.prepare(sql);
    const result = stmt.run(...params);
    return { changes: result.changes, lastInsertRowid: result.lastInsertRowid };
  }

  get<T = any>(sql: string, ...params: any[]): T | undefined {
    this.ensureOpen();
    return this.db!.prepare(sql).get(...params) as T | undefined;
  }

  all<T = any>(sql: string, ...params: any[]): T[] {
    this.ensureOpen();
    return this.db!.prepare(sql).all(...params) as T[];
  }

  // ──────────────────────────────────────────
  //  Schema Migration
  // ──────────────────────────────────────────

  private migrate(): void {
    const migrations = [
      // ── Users ──
      `CREATE TABLE IF NOT EXISTS users (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        email       TEXT UNIQUE,
        created_at  INTEGER NOT NULL
      )`,

      // ── Sessions ──
      `CREATE TABLE IF NOT EXISTS sessions (
        id           TEXT PRIMARY KEY,
        user_id      TEXT NOT NULL,
        query        TEXT NOT NULL,
        created_at   INTEGER NOT NULL,
        completed_at INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )`,

      // ── Topics ──
      `CREATE TABLE IF NOT EXISTS topics (
        id          TEXT PRIMARY KEY,
        text        TEXT NOT NULL,
        session_id  TEXT NOT NULL,
        source      TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )`,

      // ── Topic → Platform ID mapping ──
      `CREATE TABLE IF NOT EXISTS topic_platform_ids (
        topic_id    TEXT NOT NULL,
        platform    TEXT NOT NULL,
        platform_id TEXT NOT NULL,
        hashed_id   TEXT NOT NULL UNIQUE,
        PRIMARY KEY (topic_id, platform, platform_id),
        FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
      )`,

      // ── Pipeline Runs ──
      `CREATE TABLE IF NOT EXISTS pipeline_runs (
        id              TEXT PRIMARY KEY,
        session_id      TEXT NOT NULL,
        stage           TEXT NOT NULL,
        status          TEXT NOT NULL DEFAULT 'pending',
        started_at      INTEGER NOT NULL,
        completed_at    INTEGER,
        error           TEXT,
        result_summary  TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )`,

      // ── Intent Results ──
      `CREATE TABLE IF NOT EXISTS intent_results (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL UNIQUE,
        query       TEXT NOT NULL,
        result_json TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )`,

      // ── Expansion Results ──
      `CREATE TABLE IF NOT EXISTS expansion_results (
        id              TEXT PRIMARY KEY,
        session_id      TEXT NOT NULL UNIQUE,
        seed            TEXT NOT NULL,
        result_json     TEXT NOT NULL,
        candidate_count INTEGER NOT NULL,
        created_at      INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )`,

      // ── Collector Results ──
      `CREATE TABLE IF NOT EXISTS collector_results (
        id            TEXT PRIMARY KEY,
        topic_id      TEXT NOT NULL,
        session_id    TEXT NOT NULL,
        platform      TEXT NOT NULL,
        query         TEXT NOT NULL,
        result_json   TEXT NOT NULL,
        result_count  INTEGER NOT NULL,
        collected_at  INTEGER NOT NULL,
        FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )`,

      // ── Python Results ──
      `CREATE TABLE IF NOT EXISTS python_results (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL UNIQUE,
        result_json TEXT NOT NULL,
        created_at  INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )`,

      // ── Token Usage ──
      `CREATE TABLE IF NOT EXISTS token_usage (
        id              TEXT PRIMARY KEY,
        session_id      TEXT NOT NULL,
        stage           TEXT NOT NULL,
        model           TEXT NOT NULL,
        prompt_tokens   INTEGER NOT NULL,
        output_tokens   INTEGER NOT NULL,
        total_tokens    INTEGER NOT NULL,
        created_at      INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      )`,

      // ── Transcripts ──
      `CREATE TABLE IF NOT EXISTS transcripts (
        id          TEXT PRIMARY KEY,
        url         TEXT NOT NULL,
        transcript  TEXT NOT NULL,
        created_at  INTEGER NOT NULL
      )`,

      // ── Indexes ──
      `CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_topics_session_id ON topics(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_pipeline_runs_session_id ON pipeline_runs(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_collector_results_topic_session ON collector_results(topic_id, session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_collector_results_session ON collector_results(session_id)`,
      `CREATE INDEX IF NOT EXISTS idx_topic_platform_ids_hashed ON topic_platform_ids(hashed_id)`,
      `CREATE INDEX IF NOT EXISTS idx_token_usage_session_id ON token_usage(session_id)`,
    ];

    const runAll = this.db!.transaction(() => {
      for (const sql of migrations) {
        this.db!.exec(sql);
      }
    });

    runAll();
    console.log('[SqliteClient] Schema migrations applied.');
  }

  private ensureOpen(): void {
    if (!this.db) {
      throw new Error('[SqliteClient] Database not initialized. Call initialize() first.');
    }
  }
}
