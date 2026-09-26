import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { type Database, migrate } from '../packages/database/src/index.js';
import { seedDemo } from './demo-data.js';

if (process.env.DATABASE_URL || process.env.NODE_ENV === 'production')
  throw new Error('Seed data is restricted to an isolated development demo without DATABASE_URL.');
await mkdir(resolve('.demo'), { recursive: true });
const pg = new PGlite(resolve('.demo/postgres'));
const db: Database = {
  query: async (sql, params) => pg.query(sql, params),
  transaction: async (fn) =>
    pg.transaction((tx) => fn({ query: async (sql, params) => tx.query(sql, params) })),
  close: async () => pg.close(),
};
try {
  await migrate(db, resolve('packages/database/migrations/001_initial.sql'));
  await seedDemo(db);
  console.log('Seeded the isolated .demo/postgres database. Start it with pnpm demo.');
} finally {
  await db.close();
}
