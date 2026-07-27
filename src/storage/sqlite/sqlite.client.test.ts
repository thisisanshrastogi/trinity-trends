import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SqliteClient } from './sqlite.client.js';

describe('SqliteClient', () => {
  let client: SqliteClient;

  // This runs before EVERY individual `it` test block.
  // It gives us a brand new, clean database for each test.
  beforeEach(() => {
    // We pass ':memory:' as the database path.
    // This tells better-sqlite3 to create a temporary database completely in RAM.
    // It's lightning-fast and leaves absolutely no files on your hard drive!
    client = new SqliteClient(':memory:');
  });

  // This runs after EVERY individual `it` test block.
  afterEach(() => {
    // We make sure to close the connection to clean up RAM.
    client.close();
  });

  it('should initialize successfully and apply migrations', () => {
    // Calling initialize should run all the table creations without throwing an error
    expect(() => client.initialize()).not.toThrow();
  });

  it('should throw an error if running queries before initialization', () => {
    // Without calling client.initialize(), run() should safely throw a protection error
    expect(() => client.run('SELECT 1')).toThrow(/Database not initialized/);
  });

  it('should apply PRAGMA settings (WAL mode and foreign keys)', () => {
    // First, we must initialize to create the DB and apply Pragmas
    client.initialize();
    
    // Let's query SQLite's internal settings directly using `client.get`
    const journalMode = client.get<{ journal_mode: string }>('PRAGMA journal_mode');
    
    // NOTE: Because we are using ':memory:', SQLite enforces 'MEMORY' journal mode,
    // ignoring our 'WAL' pragma. If we used a real file, it would be 'WAL'.
    expect(journalMode?.journal_mode.toUpperCase()).toBe('MEMORY');
    
    const foreignKeys = client.get<{ foreign_keys: number }>('PRAGMA foreign_keys');
    expect(foreignKeys?.foreign_keys).toBe(1); // 1 means true/ON
  });

  it('should create the users table from migrations', () => {
    client.initialize();
    
    // SQLite keeps a master list of all tables in a hidden table called `sqlite_master`
    // We can query it to prove our migrations actually ran!
    const result = client.get<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='users'"
    );
    
    // We expect the result to exist and the name to match exactly
    expect(result).toBeDefined();
    expect(result?.name).toBe('users');
  });
});
