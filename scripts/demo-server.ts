import { mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import pino from 'pino';
import { createServer } from '../apps/api/src/server.js';
import { createProcessor } from '../apps/worker/src/processor.js';
import { runWorker } from '../apps/worker/src/runner.js';
import type { Database } from '../packages/database/src/index.js';
import { migrate } from '../packages/database/src/index.js';
import { GitHubClient } from '../packages/github/src/index.js';
import { demoFiles, seedDemo } from './demo-data.js';

if (process.env.NODE_ENV === 'production' || process.env.DATABASE_URL)
  throw new Error('Demo requires a development environment without DATABASE_URL');
await mkdir(resolve('.demo'), { recursive: true });
const pg = new PGlite(resolve('.demo/postgres'));
const db: Database = {
  query: async (sql, params) => pg.query(sql, params),
  transaction: async (fn) =>
    pg.transaction((tx) => fn({ query: async (sql, params) => tx.query(sql, params) })),
  close: () => pg.close(),
};
await migrate(db, resolve('packages/database/migrations/001_initial.sql'));
await seedDemo(db);
const auth = {
  identify: async () => ({ id: 1, login: 'demo-maintainer', token: '' }),
  access: async () => ({ repositoryIds: [1], writableIds: [1] }),
};
const app = await createServer({
  db,
  auth,
  webhookSecret: '',
  dashboardUrl: 'http://localhost:3000',
  demo: true,
});
app.addHook('onRequest', async (request) => {
  if (!['127.0.0.1', '::1'].includes(request.ip)) throw new Error('Demo is loopback only');
});
const githubClient = new GitHubClient({
    token: async () => {
      throw new Error('External requests disabled in demo');
    },
  }),
  github = { app: githubClient, installation: () => githubClient };
const controller = new AbortController();
await app.listen({ host: '127.0.0.1', port: 4000 });
console.log('Demo API: http://127.0.0.1:4000');
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => controller.abort());
try {
  await runWorker(
    db,
    createProcessor({ db, github, demo: true, demoSource: demoFiles, allowWrites: false }),
    pino({ level: 'warn' }),
    controller.signal,
  );
} finally {
  await app.close();
  await db.close();
}
