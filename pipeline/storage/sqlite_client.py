"""
SQLite Client for the Python pipeline.
Mirrors the TS storage/sqlite/sqlite.client.ts and sqlite.repository.ts.
"""

import sqlite3
import json
import logging
from pathlib import Path
from typing import Any, Optional, Dict, List

logger = logging.getLogger(__name__)

# Default path matching the TS implementation
DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent.parent / "data" / "trinity_trends.db"

class SqliteClient:
    """Wrapper around sqlite3 mimicking the TS SqliteClient and SqliteRepository."""

    def __init__(self, db_path: Path | str = DEFAULT_DB_PATH):
        self.db_path = Path(db_path)
        self.conn: sqlite3.Connection | None = None

    def initialize(self):
        """Initializes the database connection and runs migrations if needed."""
        if self.conn:
            return

        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(self.db_path)
        
        # Performance pragmas
        self.conn.execute("PRAGMA journal_mode = WAL")
        self.conn.execute("PRAGMA foreign_keys = ON")
        
        self.conn.row_factory = sqlite3.Row
        self._migrate()
        logger.info(f"[SqliteClient] Database initialized at {self.db_path}")

    def close(self):
        """Closes the connection."""
        if self.conn:
            self.conn.close()
            self.conn = None

    def _migrate(self):
        """Creates tables if they don't exist, matching the TS schema."""
        migrations = [
            # Users
            '''CREATE TABLE IF NOT EXISTS users (
                id          TEXT PRIMARY KEY,
                name        TEXT NOT NULL,
                email       TEXT UNIQUE,
                created_at  INTEGER NOT NULL
            )''',
            # Sessions
            '''CREATE TABLE IF NOT EXISTS sessions (
                id           TEXT PRIMARY KEY,
                user_id      TEXT NOT NULL,
                query        TEXT NOT NULL,
                created_at   INTEGER NOT NULL,
                completed_at INTEGER,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )''',
            # Topics
            '''CREATE TABLE IF NOT EXISTS topics (
                id          TEXT PRIMARY KEY,
                text        TEXT NOT NULL,
                session_id  TEXT NOT NULL,
                source      TEXT NOT NULL,
                created_at  INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )''',
            # Topic Platform IDs
            '''CREATE TABLE IF NOT EXISTS topic_platform_ids (
                topic_id    TEXT NOT NULL,
                platform    TEXT NOT NULL,
                platform_id TEXT NOT NULL,
                hashed_id   TEXT NOT NULL UNIQUE,
                PRIMARY KEY (topic_id, platform, platform_id),
                FOREIGN KEY (topic_id) REFERENCES topics(id) ON DELETE CASCADE
            )''',
            # Pipeline Runs
            '''CREATE TABLE IF NOT EXISTS pipeline_runs (
                id              TEXT PRIMARY KEY,
                session_id      TEXT NOT NULL,
                stage           TEXT NOT NULL,
                status          TEXT NOT NULL DEFAULT 'pending',
                started_at      INTEGER NOT NULL,
                completed_at    INTEGER,
                error           TEXT,
                result_summary  TEXT,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )''',
            # Intent Results
            '''CREATE TABLE IF NOT EXISTS intent_results (
                id          TEXT PRIMARY KEY,
                session_id  TEXT NOT NULL UNIQUE,
                query       TEXT NOT NULL,
                result_json TEXT NOT NULL,
                created_at  INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )''',
            # Expansion Results
            '''CREATE TABLE IF NOT EXISTS expansion_results (
                id              TEXT PRIMARY KEY,
                session_id      TEXT NOT NULL UNIQUE,
                seed            TEXT NOT NULL,
                result_json     TEXT NOT NULL,
                candidate_count INTEGER NOT NULL,
                created_at      INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )''',
            # Collector Results
            '''CREATE TABLE IF NOT EXISTS collector_results (
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
            )''',
            # Pipeline Analysis Results (New Table for Python pipeline)
            '''CREATE TABLE IF NOT EXISTS analysis_results (
                id              TEXT PRIMARY KEY,
                session_id      TEXT NOT NULL UNIQUE,
                topic           TEXT NOT NULL,
                result_json     TEXT NOT NULL,
                signal_count    INTEGER NOT NULL,
                created_at      INTEGER NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )''',
            # Indexes
            "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)",
            "CREATE INDEX IF NOT EXISTS idx_topics_session_id ON topics(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_pipeline_runs_session_id ON pipeline_runs(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_collector_results_topic_session ON collector_results(topic_id, session_id)",
            "CREATE INDEX IF NOT EXISTS idx_collector_results_session ON collector_results(session_id)",
            "CREATE INDEX IF NOT EXISTS idx_topic_platform_ids_hashed ON topic_platform_ids(hashed_id)"
        ]

        with self.conn:
            for sql in migrations:
                self.conn.execute(sql)
                
    def save_analysis_result(self, record_id: str, session_id: str, topic: str, result_json: str, signal_count: int, created_at: int):
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO analysis_results (id, session_id, topic, result_json, signal_count, created_at)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(session_id) DO UPDATE SET
                    result_json=excluded.result_json,
                    signal_count=excluded.signal_count
                """,
                (record_id, session_id, topic, result_json, signal_count, created_at)
            )

    def get_collector_results_by_session(self, session_id: str) -> List[Dict[str, Any]]:
        cursor = self.conn.execute(
            "SELECT * FROM collector_results WHERE session_id = ?",
            (session_id,)
        )
        return [dict(row) for row in cursor.fetchall()]

    def update_pipeline_run(self, run_id: str, status: str, completed_at: Optional[int] = None, error: Optional[str] = None, result_summary: Optional[str] = None):
        updates = ["status = ?"]
        params = [status]
        
        if completed_at is not None:
            updates.append("completed_at = ?")
            params.append(completed_at)
        if error is not None:
            updates.append("error = ?")
            params.append(error)
        if result_summary is not None:
            updates.append("result_summary = ?")
            params.append(result_summary)
            
        params.append(run_id)
        
        with self.conn:
            self.conn.execute(
                f"UPDATE pipeline_runs SET {', '.join(updates)} WHERE id = ?",
                tuple(params)
            )

    def create_pipeline_run(self, run_id: str, session_id: str, stage: str, status: str, started_at: int):
        with self.conn:
            self.conn.execute(
                """
                INSERT INTO pipeline_runs (id, session_id, stage, status, started_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (run_id, session_id, stage, status, started_at)
            )
