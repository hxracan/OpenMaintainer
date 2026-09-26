import { OpenAIProvider } from '@openmaintainer/ai';
import { connect } from '@openmaintainer/database';
import { appJwt, GitHubClient, installationClient } from '@openmaintainer/github';
import { loadRegistry } from '@openmaintainer/plugin-sdk';
import pino from 'pino';
import { z } from 'zod';
import { createProcessor } from './processor.js';
import { runWorker, scheduleMaintenance } from './runner.js';

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    GITHUB_APP_ID: z.string().regex(/^\d+$/),
    GITHUB_PRIVATE_KEY: z.string().min(1),
    ALLOW_AUTOMATION_WRITES: z.enum(['true', 'false']).default('false'),
  })
  .parse(process.env);
const db = connect(env.DATABASE_URL),
  logger = pino(),
  controller = new AbortController(),
  key = env.GITHUB_PRIVATE_KEY.replaceAll('\\n', '\n');
const github = {
  app: new GitHubClient({ token: async () => appJwt(env.GITHUB_APP_ID, key) }),
  installation: (id: number, ids?: number[]) => installationClient(env.GITHUB_APP_ID, key, id, ids),
};
const plugins = process.env.OPENMAINTAINER_PLUGINS
  ? await loadRegistry(process.env.OPENMAINTAINER_PLUGINS)
  : [];
await db.transaction(async (tx) => {
  await tx.query('UPDATE plugins SET enabled=false');
  for (const plugin of plugins) {
    const { entry: _entry, ...publicManifest } = plugin;
    await tx.query(
      'INSERT INTO plugins(name,version,enabled,manifest) VALUES($1,$2,true,$3) ON CONFLICT(name) DO UPDATE SET version=EXCLUDED.version,enabled=true,manifest=EXCLUDED.manifest',
      [plugin.name, plugin.version, JSON.stringify(publicManifest)],
    );
  }
});
const ai =
  process.env.OPENAI_API_KEY && process.env.OPENAI_MODEL
    ? new OpenAIProvider({
        apiKey: process.env.OPENAI_API_KEY,
        model: process.env.OPENAI_MODEL,
        embeddingModel: process.env.OPENAI_EMBEDDING_MODEL,
      })
    : undefined;
const processor = createProcessor({
  db,
  github,
  plugins,
  ai,
  allowWrites: env.ALLOW_AUTOMATION_WRITES === 'true',
});
for (const signal of ['SIGTERM', 'SIGINT'] as const) process.once(signal, () => controller.abort());
await scheduleMaintenance(db);
const scheduler = setInterval(() => {
  void scheduleMaintenance(db).catch(() =>
    logger.error({ code: 'SCHEDULER' }, 'Maintenance scheduling failed'),
  );
}, 3600000);
try {
  await runWorker(db, processor, logger, controller.signal);
} finally {
  clearInterval(scheduler);
  await db.close();
}
