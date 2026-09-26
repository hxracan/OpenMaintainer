import { connect } from '@openmaintainer/database';
import { z } from 'zod';
import { githubAuth } from './auth.js';
import { createServer } from './server.js';

const env = z
  .object({
    DATABASE_URL: z.string().min(1),
    GITHUB_WEBHOOK_SECRET: z.string().min(32),
    GITHUB_CLIENT_ID: z.string().min(1),
    GITHUB_CLIENT_SECRET: z.string().min(1),
    TOKEN_ENCRYPTION_KEY: z.string().regex(/^[a-f0-9]{64}$/i),
    DASHBOARD_URL: z.url(),
    PORT: z.coerce.number().default(4000),
    HOST: z.string().default('127.0.0.1'),
  })
  .parse(process.env);
const db = connect(env.DATABASE_URL),
  app = await createServer({
    db,
    auth: githubAuth(db, env.TOKEN_ENCRYPTION_KEY),
    webhookSecret: env.GITHUB_WEBHOOK_SECRET,
    dashboardUrl: env.DASHBOARD_URL,
    logger: true,
    oauth: {
      clientId: env.GITHUB_CLIENT_ID,
      clientSecret: env.GITHUB_CLIENT_SECRET,
      dashboardUrl: env.DASHBOARD_URL,
      encryptionKey: env.TOKEN_ENCRYPTION_KEY,
    },
  });
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.once(signal, () => {
    void app.close().then(() => db.close());
  });
await app.listen({ host: env.HOST, port: env.PORT });
