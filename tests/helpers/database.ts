import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { type Database, migrate } from '../../packages/database/src/index.js';
export async function testDatabase(): Promise<Database> {
  const pg = new PGlite();
  const db: Database = {
    query: async (sql, params) => pg.query(sql, params),
    transaction: async (fn) =>
      pg.transaction((tx) => fn({ query: async (sql, params) => tx.query(sql, params) })),
    close: async () => pg.close(),
  };
  await migrate(db, resolve('packages/database/migrations/001_initial.sql'));
  return db;
}
