import pg, { Pool as PgPool, QueryResultRow } from "pg";
import { applySchema } from "./schema.js";

let _pool: PgPool | null = null;
let _initPromise: Promise<PgPool> | null = null;

export async function initDatabase(databaseUrl: string): Promise<PgPool> {
  if (_pool) return _pool;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    _pool = new PgPool({
      connectionString: databaseUrl,
      ssl: false,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
    });

    try {
      await _pool.query("SELECT 1");
      console.log("Connected to PostgreSQL");
    } catch (err) {
      console.error("Failed to connect to PostgreSQL:", err);
      throw err;
    }

    await applySchema(_pool);
    return _pool;
  })();

  return _initPromise;
}

export function getPool(): PgPool {
  if (!_pool) {
    throw new Error("Database not initialized. Call initDatabase() first.");
  }
  return _pool;
}

export async function query<T extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(sql, params);
}

export async function getOne<T extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T | null> {
  const result = await getPool().query<T>(sql, params);
  return result.rows[0] ?? null;
}

export async function getAll<T extends QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T[]> {
  const result = await getPool().query<T>(sql, params);
  return result.rows;
}

export type Pool = PgPool;

export function getDb() {
  throw new Error("SQLite not supported. Use initDatabase() and query() instead.");
}