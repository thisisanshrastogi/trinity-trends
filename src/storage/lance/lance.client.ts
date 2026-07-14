import * as lancedb from '@lancedb/lancedb';
import path from 'path';

const DEFAULT_DB_PATH = path.resolve(process.cwd(), '.lancedb');

/**
 * Manages a shared LanceDB connection with multiple named tables.
 * Tables are lazily created on first write (LanceDB requires data to infer schema).
 */
export class LanceClient {
  private db: lancedb.Connection | null = null;
  private tables: Map<string, lancedb.Table> = new Map();
  private readonly dbPath: string;

  constructor(dbPath: string = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
  }

  // ──────────────────────────────────────────
  //  Connection
  // ──────────────────────────────────────────

  async connect(): Promise<lancedb.Connection> {
    if (this.db) return this.db;

    this.db = await lancedb.connect(this.dbPath);
    console.log(`[LanceClient] Connected to ${this.dbPath}`);
    return this.db;
  }

  async close(): Promise<void> {
    this.tables.clear();
    this.db = null;
  }

  // ──────────────────────────────────────────
  //  Table Management
  // ──────────────────────────────────────────

  /**
   * Opens an existing table or returns null if it doesn't exist yet.
   * Tables that don't exist will be created lazily when data is first written.
   */
  async openTable(tableName: string): Promise<lancedb.Table | null> {
    if (this.tables.has(tableName)) {
      return this.tables.get(tableName)!;
    }

    const db = await this.connect();
    const existingTables = await db.tableNames();

    if (existingTables.includes(tableName)) {
      const table = await db.openTable(tableName);
      this.tables.set(tableName, table);
      return table;
    }

    return null;
  }

  /**
   * Creates a table with initial data. If the table already exists, opens it instead.
   */
  async createTable(tableName: string, data: Record<string, any>[]): Promise<lancedb.Table> {
    const db = await this.connect();
    const existingTables = await db.tableNames();

    let table: lancedb.Table;
    if (existingTables.includes(tableName)) {
      table = await db.openTable(tableName);
    } else {
      table = await db.createTable(tableName, data);
    }

    this.tables.set(tableName, table);
    return table;
  }

  /**
   * Adds data to an existing table. Creates the table if it doesn't exist.
   */
  async addToTable(tableName: string, data: Record<string, any>[]): Promise<lancedb.Table> {
    let table = await this.openTable(tableName);

    if (!table) {
      // Table doesn't exist — create it with this data
      table = await this.createTable(tableName, data);
    } else {
      await table.add(data);
    }

    return table;
  }

  /**
   * Query rows with a SQL-like filter.
   */
  async filter(tableName: string, where: string, select?: string[]): Promise<any[]> {
    const table = await this.openTable(tableName);
    if (!table) return [];

    try {
      let query = table.query().where(where);
      if (select) query = query.select(select);
      return await query.toArray();
    } catch (err) {
      console.warn(`[LanceClient] Filter error on "${tableName}":`, err);
      return [];
    }
  }

  /**
   * Vector similarity search on a table.
   */
  async vectorSearch(
    tableName: string,
    queryVector: number[],
    topK: number,
    distanceType: 'l2' | 'cosine' | 'dot' = 'cosine',
  ): Promise<any[]> {
    const table = await this.openTable(tableName);
    if (!table) return [];

    return table
      .vectorSearch(queryVector)
      .distanceType(distanceType)
      .limit(topK)
      .toArray();
  }
}
