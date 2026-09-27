import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import { workflows } from '@openmaintainer/ai';
import { planAutomations } from '@openmaintainer/automation-engine';
import { conditionSchema, configSchema, defaultConfig, ruleSchema, triggers } from '@openmaintainer/config';
import type { Database } from '@openmaintainer/database';
import { audit, cancel, enqueue } from '@openmaintainer/database';
import { acceptWebhook } from '@openmaintainer/github-app';
import { evaluateRule } from '@openmaintainer/rule-engine';
import { AppError, asRecord, positiveId, repositoryName } from '@openmaintainer/shared';
import Fastify, { type FastifyRequest, LogController } from 'fastify';
import { z } from 'zod';
import type { Access, Auth, Identity, OAuthOptions } from './auth.js';
import { registerOAuth } from './auth.js';
import { scanPublicRepository } from './public-scan.js';

declare module 'fastify' {
  interface FastifyRequest {
    identity?: Identity;
    access?: Access;
  }
}
export interface ServerOptions {
  db: Database;
  auth: Auth;
  webhookSecret: string;
  dashboardUrl: string;
  demo?: boolean;
  oauth?: OAuthOptions;
  logger?: boolean;
  publicScanFetch?: typeof fetch;
}
const pageSchema = z.object({
  offset: z.coerce.number().int().min(0).max(100000).default(0),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});
export async function createServer(options: ServerOptions) {
  const { db } = options;
  const app = Fastify({
    bodyLimit: 2_000_000,
    logger: options.logger
      ? {
          redact: ['req.headers.authorization', 'req.headers.cookie', 'res.headers.set-cookie'],
          level: 'info',
        }
      : false,
    logController: new LogController({ disableRequestLogging: true }),
  });
  await app.register(cookie);
  await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });
  app.addHook('onSend', async (_request, reply) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Cache-Control', 'no-store');
    reply.header('Referrer-Policy', 'no-referrer');
  });
  app.setErrorHandler((error, request, reply) => {
    const errorStatus = asRecord(error).statusCode;
    const status =
      error instanceof AppError
        ? error.status
        : error instanceof z.ZodError
          ? 400
          : typeof errorStatus === 'number' && errorStatus < 500
            ? errorStatus
            : 500;
    const code =
      error instanceof AppError ? error.code : error instanceof z.ZodError ? 'VALIDATION' : 'INTERNAL';
    app.log.warn({ requestId: request.id, code, status }, 'Request failed');
    return reply.status(status).send({
      error: {
        code,
        message:
          error instanceof AppError
            ? error.message
            : error instanceof z.ZodError
              ? 'Invalid request input'
              : 'Request failed',
        requestId: request.id,
      },
    });
  });
  app.get('/health', async () => ({ status: 'ok', mode: options.demo ? 'demo' : 'production' }));
  app.get('/ready', async () => {
    await db.query('SELECT 1');
    return { status: 'ready' };
  });
  app.register(async (hooks) => {
    hooks.removeContentTypeParser('application/json');
    hooks.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_request, body, done) =>
      done(null, body),
    );
    hooks.post('/webhooks/github', async (request, reply) => {
      if (options.demo) throw new AppError('DEMO_WEBHOOK', 'Webhooks are disabled in demo mode', 403);
      const result = await acceptWebhook(
        db,
        request.body as Buffer,
        {
          signature:
            typeof request.headers['x-hub-signature-256'] === 'string'
              ? request.headers['x-hub-signature-256']
              : undefined,
          delivery:
            typeof request.headers['x-github-delivery'] === 'string'
              ? request.headers['x-github-delivery']
              : undefined,
          event:
            typeof request.headers['x-github-event'] === 'string'
              ? request.headers['x-github-event']
              : undefined,
        },
        options.webhookSecret,
      );
      return reply.status(202).send(result);
    });
  });
  if (options.oauth) await registerOAuth(app, db, options.oauth);
  let activePublicScans = 0;
  app.post(
    '/api/public-scan',
    { bodyLimit: 2048, config: { rateLimit: { max: 6, timeWindow: '1 minute' } } },
    async (request) => {
      const { repository } = z
        .object({ repository: z.string().min(1).max(250) })
        .strict()
        .parse(request.body);
      if (activePublicScans >= 2)
        throw new AppError('SCAN_BUSY', 'The checker is busy. Please try again shortly.', 429);
      activePublicScans++;
      try {
        return { data: await scanPublicRepository(repository, options.publicScanFetch) };
      } finally {
        activePublicScans--;
      }
    },
  );
  app.register(async (api) => {
    api.addHook('preHandler', async (request) => {
      request.identity = await options.auth.identify(request);
      request.access = await options.auth.access(request.identity);
      if (
        !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
        !request.headers.authorization &&
        request.headers.origin !== new URL(options.dashboardUrl).origin
      )
        throw new AppError('ORIGIN', 'Invalid request origin', 403);
    });
    const ids = (r: FastifyRequest) => r.access?.repositoryIds ?? [];
    const write = (r: FastifyRequest, id: number) => {
      if (!r.access?.writableIds.includes(id))
        throw new AppError('FORBIDDEN', 'Repository write permission required', 403);
    };
    const repo = async (request: FastifyRequest) => {
      const p = z.object({ owner: z.string(), repo: z.string() }).parse(request.params);
      const name = repositoryName.parse(`${p.owner}/${p.repo}`);
      const result = await db.query<{
        id: number;
        full_name: string;
        installation_id: number;
        profile: unknown;
        config: unknown;
        snapshot: unknown;
      }>('SELECT * FROM repositories WHERE full_name=$1 AND id=ANY($2::bigint[])', [name, ids(request)]);
      const value = result.rows[0];
      if (!value) throw new AppError('NOT_FOUND', 'Repository not found', 404);
      return { ...value, id: Number(value.id) };
    };
    api.get('/api/session', async (r) => ({
      user: { id: r.identity?.id, login: r.identity?.login },
      mode: options.demo ? 'demo' : 'production',
    }));
    api.get('/api/repositories', async (r) => {
      const p = pageSchema.parse(r.query);
      const data = await db.query(
        'SELECT id,full_name,default_branch,private,archived,profile,updated_at FROM repositories WHERE id=ANY($1::bigint[]) ORDER BY full_name LIMIT $2 OFFSET $3',
        [ids(r), p.limit, p.offset],
      );
      return { data: data.rows, page: p };
    });
    api.get('/api/repositories/:owner/:repo', async (r) => {
      const repository = await repo(r);
      const [prs, issues, runs, releases] = await Promise.all([
        db.query('SELECT * FROM pull_requests WHERE repository_id=$1 ORDER BY updated_at DESC LIMIT 10', [
          repository.id,
        ]),
        db.query('SELECT * FROM issues WHERE repository_id=$1 ORDER BY updated_at DESC LIMIT 10', [
          repository.id,
        ]),
        db.query('SELECT * FROM workflow_runs WHERE repository_id=$1 ORDER BY updated_at DESC LIMIT 10', [
          repository.id,
        ]),
        db.query('SELECT * FROM releases WHERE repository_id=$1 ORDER BY created_at DESC LIMIT 5', [
          repository.id,
        ]),
      ]);
      return {
        data: {
          ...repository,
          recentPullRequests: prs.rows.map((p) => ({ ...p, full_name: repository.full_name })),
          recentIssues: issues.rows,
          recentWorkflows: runs.rows,
          releases: releases.rows,
        },
      };
    });
    api.post('/api/repositories/:owner/:repo/analyze', async (r, reply) => {
      const repository = await repo(r);
      write(r, repository.id);
      const jobId = await db.transaction(async (tx) => {
        const id = await enqueue(tx, 'repository.index', {}, repository.id);
        await audit(tx, r.identity?.login ?? 'unknown', repository.id, 'analysis.started', id);
        return id;
      });
      return reply.status(202).send({ jobId });
    });
    for (const [endpoint, table, kind] of [
      ['pull-requests', 'pull_requests', 'pr.analyze'],
      ['issues', 'issues', 'issue.analyze'],
      ['ci', 'workflow_runs', 'ci.analyze'],
    ] as const) {
      api.get(`/api/${endpoint}`, async (r) => {
        const p = pageSchema.parse(r.query);
        const data = await db.query(
          `SELECT t.*,r.full_name FROM ${table} t JOIN repositories r ON r.id=t.repository_id WHERE t.repository_id=ANY($1::bigint[]) ORDER BY t.updated_at DESC LIMIT $2 OFFSET $3`,
          [ids(r), p.limit, p.offset],
        );
        return { data: data.rows, page: p };
      });
      api.get(`/api/${endpoint}/:owner/:repo/:number`, async (r) => {
        const repository = await repo(r),
          number = positiveId.parse(asRecord(r.params).number);
        const data = await db.query(
          `SELECT data FROM ${table} WHERE repository_id=$1 AND ${table === 'workflow_runs' ? 'id' : 'number'}=$2`,
          [repository.id, number],
        );
        if (!data.rows[0]) throw new AppError('NOT_FOUND', 'Item not found', 404);
        const analyses = await db.query(
          'SELECT kind,result,created_at FROM analyses WHERE repository_id=$1 AND subject=$2 AND kind=$3 ORDER BY created_at DESC LIMIT 1',
          [repository.id, String(number), kind],
        );
        return { data: data.rows[0].data, analyses: analyses.rows };
      });
      api.post(`/api/${endpoint}/:owner/:repo/:number/analyze`, async (r, reply) => {
        const repository = await repo(r);
        write(r, repository.id);
        const number = positiveId.parse(asRecord(r.params).number);
        const jobId = await enqueue(db, kind, { number }, repository.id);
        await audit(db, r.identity?.login ?? 'unknown', repository.id, 'analysis.started', jobId);
        return reply.status(202).send({ jobId });
      });
    }
    api.post('/api/issues/:owner/:repo/:number/duplicates', async (r, reply) => {
      const repository = await repo(r);
      write(r, repository.id);
      return reply.status(202).send({
        jobId: await enqueue(
          db,
          'issue.duplicates',
          { number: positiveId.parse(asRecord(r.params).number) },
          repository.id,
        ),
      });
    });
    api.get('/api/issues/:owner/:repo/:number/duplicates', async (r) => {
      const repository = await repo(r),
        number = positiveId.parse(asRecord(r.params).number);
      if (
        !(
          await db.query('SELECT number FROM issues WHERE repository_id=$1 AND number=$2', [
            repository.id,
            number,
          ])
        ).rows.length
      )
        throw new AppError('NOT_FOUND', 'Issue not found', 404);
      return {
        data:
          (
            await db.query(
              "SELECT result,created_at FROM analyses WHERE repository_id=$1 AND kind='issue.duplicates' AND subject=$2 ORDER BY created_at DESC LIMIT 1",
              [repository.id, String(number)],
            )
          ).rows[0] ?? null,
      };
    });
    api.post('/api/repositories/:owner/:repo/automations/preview', async (r) => {
      const repository = await repo(r);
      const body = z
        .object({
          trigger: z.enum(triggers),
          facts: z.partialRecord(conditionSchema.shape.field, conditionSchema.shape.value).default({}),
          number: positiveId.optional(),
          config: configSchema.optional(),
        })
        .strict()
        .parse(r.body);
      const config = body.config ?? configSchema.parse(repository.config ?? defaultConfig());
      if (!body.config)
        config.rules = (
          await db.query<{ rule: unknown }>('SELECT rule FROM automation_rules WHERE repository_id=$1', [
            repository.id,
          ])
        ).rows.map((row) => ruleSchema.parse(row.rule));
      const event = {
        id: 'preview',
        trigger: body.trigger,
        repository: repository.full_name,
        repositoryId: repository.id,
        installationId: Number(repository.installation_id),
        actor: r.identity?.login ?? 'preview',
        subjectNumber: body.number,
        facts: body.facts,
      };
      return {
        dryRun: true,
        evaluations: config.rules.map((rule) => ({
          ...evaluateRule(rule, event),
          enabled: rule.enabled,
          expectedTrigger: rule.when,
        })),
        plans: planAutomations(config, event, {
          allowWrites: false,
          allowedActions: [
            'addLabel',
            'removeLabel',
            'assignUser',
            'requestReviewer',
            'postComment',
            'createIssue',
            'sendNotification',
            'queueAnalysis',
          ],
        }),
      };
    });
    api.get('/api/automations', async (r) => ({
      data: (
        await db.query(
          'SELECT a.*,r.full_name FROM automation_rules a JOIN repositories r ON r.id=a.repository_id WHERE repository_id=ANY($1::bigint[]) ORDER BY a.id LIMIT 100',
          [ids(r)],
        )
      ).rows,
    }));
    api.post('/api/automations', async (r) => {
      const body = z.object({ repositoryId: positiveId, rule: ruleSchema }).strict().parse(r.body);
      write(r, body.repositoryId);
      await db.transaction(async (tx) => {
        await tx.query(
          'INSERT INTO automation_rules(repository_id,id,rule) VALUES($1,$2,$3) ON CONFLICT(repository_id,id) DO UPDATE SET rule=EXCLUDED.rule,updated_at=now()',
          [body.repositoryId, body.rule.id, JSON.stringify(body.rule)],
        );
        await audit(
          tx,
          r.identity?.login ?? 'unknown',
          body.repositoryId,
          'configuration.changed',
          body.rule.id,
        );
      });
      return { saved: true };
    });
    api.put('/api/repositories/:owner/:repo/config', async (r) => {
      const repository = await repo(r);
      write(r, repository.id);
      const config = configSchema.parse(r.body);
      await db.transaction(async (tx) => {
        await tx.query('UPDATE repositories SET config=$2 WHERE id=$1', [
          repository.id,
          JSON.stringify(config),
        ]);
        await tx.query('DELETE FROM automation_rules WHERE repository_id=$1', [repository.id]);
        for (const rule of config.rules)
          await tx.query('INSERT INTO automation_rules(repository_id,id,rule) VALUES($1,$2,$3)', [
            repository.id,
            rule.id,
            JSON.stringify(rule),
          ]);
        await audit(tx, r.identity?.login ?? 'unknown', repository.id, 'configuration.changed', 'version 1');
      });
      return { data: config };
    });
    api.get('/api/repositories/:owner/:repo/config', async (r) => ({
      data: (await repo(r)).config ?? defaultConfig(),
    }));
    api.get('/api/jobs/:id', async (r) => {
      const id = z
        .string()
        .regex(/^[a-f0-9]{32,64}$/)
        .parse(asRecord(r.params).id);
      const result = await db.query(
        'SELECT id,kind,status,attempts,max_attempts,error_code,result,created_at,updated_at FROM jobs WHERE id=$1 AND repository_id=ANY($2::bigint[])',
        [id, ids(r)],
      );
      if (!result.rows[0]) throw new AppError('NOT_FOUND', 'Job not found', 404);
      return {
        data: result.rows[0],
        history: (
          await db.query('SELECT status,detail,created_at FROM job_history WHERE job_id=$1 ORDER BY id', [id])
        ).rows,
      };
    });
    api.get('/api/jobs', async (r) => {
      const p = pageSchema.parse(r.query);
      return {
        data: (
          await db.query(
            'SELECT j.id,j.kind,j.repository_id,j.status,j.attempts,j.error_code,j.created_at,j.updated_at,r.full_name FROM jobs j JOIN repositories r ON r.id=j.repository_id WHERE j.repository_id=ANY($1::bigint[]) ORDER BY j.created_at DESC LIMIT $2 OFFSET $3',
            [ids(r), p.limit, p.offset],
          )
        ).rows,
        page: p,
      };
    });
    api.post('/api/jobs/:id/cancel', async (r) => {
      const id = z
        .string()
        .regex(/^[a-f0-9]{32,64}$/)
        .parse(asRecord(r.params).id);
      const result = await db.query<{ repository_id: number }>(
        'SELECT repository_id FROM jobs WHERE id=$1 AND repository_id=ANY($2::bigint[])',
        [id, ids(r)],
      );
      const row = result.rows[0];
      if (!row) throw new AppError('NOT_FOUND', 'Job not found', 404);
      write(r, Number(row.repository_id));
      if (!(await cancel(db, id)))
        throw new AppError('JOB_RUNNING', 'Only queued jobs can be cancelled', 409);
      await audit(db, r.identity?.login ?? 'unknown', Number(row.repository_id), 'job.cancelled', id);
      return { cancelled: true };
    });
    api.post('/api/webhooks/:id/replay', async (r, reply) => {
      const id = z
        .string()
        .regex(/^[\w-]{1,100}$/)
        .parse(asRecord(r.params).id);
      const result = await db.query<{ repository_id: number; payload: unknown }>(
        'SELECT repository_id,payload FROM webhook_deliveries WHERE id=$1 AND repository_id=ANY($2::bigint[])',
        [id, ids(r)],
      );
      const row = result.rows[0];
      if (!row?.payload) throw new AppError('NOT_FOUND', 'Retained delivery not found', 404);
      write(r, Number(row.repository_id));
      const jobId = await enqueue(db, 'webhook.process', { deliveryId: id }, Number(row.repository_id));
      await audit(db, r.identity?.login ?? 'unknown', Number(row.repository_id), 'webhook.replay', id);
      return reply.status(202).send({ jobId });
    });
    for (const [endpoint, table] of [
      ['audit', 'audit_events'],
      ['releases', 'releases'],
      ['notifications', 'notifications'],
      ['automation-runs', 'automation_runs'],
    ] as const)
      api.get(`/api/${endpoint}`, async (r) => {
        const p = pageSchema.parse(r.query);
        return {
          data: (
            await db.query(
              `SELECT t.*,r.full_name FROM ${table} t LEFT JOIN repositories r ON r.id=t.repository_id WHERE repository_id=ANY($1::bigint[]) ORDER BY t.created_at DESC LIMIT $2 OFFSET $3`,
              [ids(r), p.limit, p.offset],
            )
          ).rows,
          page: p,
        };
      });
    api.post('/api/releases/:owner/:repo/prepare', async (r, reply) => {
      const repository = await repo(r);
      write(r, repository.id);
      const body = z
        .object({
          version: z.string().max(50),
          fromRef: z
            .string()
            .regex(/^[A-Za-z0-9_./-]{1,200}$/)
            .refine((v) => !v.includes('..')),
        })
        .strict()
        .parse(r.body);
      const jobId = await enqueue(db, 'release.prepare', body, repository.id);
      await audit(db, r.identity?.login ?? 'unknown', repository.id, 'release.requested', jobId);
      return reply.status(202).send({ jobId });
    });
    api.get('/api/analytics', async (r) => ({
      data: (
        await db.query(
          'SELECT kind,status,count(*)::int AS count FROM jobs WHERE repository_id=ANY($1::bigint[]) GROUP BY kind,status ORDER BY kind,status',
          [ids(r)],
        )
      ).rows,
      aiUsage: (
        await db.query(
          'SELECT model,sum(input_tokens)::int AS input_tokens,sum(output_tokens)::int AS output_tokens FROM ai_usage WHERE repository_id=ANY($1::bigint[]) GROUP BY model',
          [ids(r)],
        )
      ).rows,
    }));
    api.post('/api/repositories/:owner/:repo/ai', async (r, reply) => {
      const repository = await repo(r);
      write(r, repository.id);
      if (options.demo) throw new AppError('AI_DISABLED', 'AI is disabled in the credential-free demo', 403);
      const config = configSchema.parse(repository.config ?? defaultConfig());
      if (!config.ai.enabled)
        throw new AppError('AI_DISABLED', 'Enable AI in repository settings first', 403);
      const body = z
        .object({ workflow: z.enum(workflows), subject: z.string().min(1).max(100).default('repository') })
        .strict()
        .parse(r.body);
      const jobId = await enqueue(db, 'ai.analyze', body, repository.id);
      await audit(db, r.identity?.login ?? 'unknown', repository.id, 'ai.requested', body.workflow);
      return reply.status(202).send({ jobId });
    });
    api.get('/api/repositories/:owner/:repo/analyses', async (r) => {
      const repository = await repo(r),
        p = pageSchema.parse(r.query);
      return {
        data: (
          await db.query(
            'SELECT id,kind,subject,result,created_at FROM analyses WHERE repository_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3',
            [repository.id, p.limit, p.offset],
          )
        ).rows,
        page: p,
      };
    });
    api.get('/api/plugins', async () => ({
      data: (await db.query('SELECT name,version,enabled,manifest FROM plugins ORDER BY name')).rows,
    }));
    api.get('/api/dashboard', async (r) => {
      const visible = ids(r);
      const counts = await db.query(
        "SELECT (SELECT count(*)::int FROM repositories WHERE id=ANY($1::bigint[])) AS repositories,(SELECT count(*)::int FROM pull_requests WHERE repository_id=ANY($1::bigint[]) AND data->>'state'='open') AS pull_requests,(SELECT count(*)::int FROM issues WHERE repository_id=ANY($1::bigint[]) AND data->>'state'='open') AS issues,(SELECT count(*)::int FROM workflow_runs WHERE repository_id=ANY($1::bigint[]) AND data->>'conclusion'='failure') AS failing_runs,(SELECT count(*)::int FROM jobs WHERE repository_id=ANY($1::bigint[]) AND status='dead') AS failed_jobs",
        [visible],
      );
      return {
        data: counts.rows[0],
        activity: (
          await db.query(
            'SELECT action,result,created_at FROM audit_events WHERE repository_id=ANY($1::bigint[]) ORDER BY created_at DESC LIMIT 12',
            [visible],
          )
        ).rows,
      };
    });
  });
  return app;
}
