import { readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export { cancel, claim, enqueue, finish, heartbeat, type Job } from './jobs.js';
export type Row = Record<string, unknown>;
export interface Sql {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
}
export interface Database extends Sql {
  transaction<T>(fn: (tx: Sql) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function connect(url: string): Database {
  const pool = new pg.Pool({
    connectionString: url,
    max: 10,
    statement_timeout: 15000,
    application_name: 'openmaintainer',
  });
  const query: Sql['query'] = async (sql, params) => pool.query(sql, params);
  return {
    query,
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const result = await fn({ query: async (sql, p) => client.query(sql, p) });
        await client.query('COMMIT');
        return result;
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    },
    async close() {
      await pool.end();
    },
  };
}
export async function migrate(
  db: Database,
  migrationPath = fileURLToPath(new URL('../migrations/001_initial.sql', import.meta.url)),
): Promise<void> {
  const directory = dirname(migrationPath);
  const migrations = (await readdir(directory))
    .filter((name) => /^\d{3}_[a-z0-9_-]+\.sql$/.test(name))
    .sort();
  await db.transaction(async (tx) => {
    await tx.query(
      'CREATE TABLE IF NOT EXISTS schema_migrations (version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())',
    );
    await tx.query('LOCK TABLE schema_migrations IN EXCLUSIVE MODE');
    for (const name of migrations) {
      const version = Number(name.slice(0, 3));
      const found = await tx.query('SELECT version FROM schema_migrations WHERE version=$1', [version]);
      if (!found.rows.length) {
        const sql = await readFile(join(directory, name), 'utf8');
        // Authored migrations contain simple DDL/DML, without procedural or quoted semicolons.
        for (const statement of sql.split(';').filter((part) => part.trim())) await tx.query(statement);
        await tx.query('INSERT INTO schema_migrations(version) VALUES($1)', [version]);
      }
    }
  });
}
export async function audit(
  db: Sql,
  actor: string,
  repositoryId: number | null,
  action: string,
  result: string,
): Promise<void> {
  await db.query('INSERT INTO audit_events(actor,repository_id,action,result) VALUES($1,$2,$3,$4)', [
    actor,
    repositoryId,
    action,
    result,
  ]);
}
