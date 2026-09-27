import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { decryptToken, encryptToken } from '../apps/api/src/auth.js';
import { createServer } from '../apps/api/src/server.js';
import { parseConfig } from '../packages/config/src/index.js';
import type { Database } from '../packages/database/src/index.js';
import { cancel, claim, enqueue, finish } from '../packages/database/src/index.js';
import { acceptWebhook, verifySignature } from '../packages/github-app/src/index.js';
import { testDatabase } from './helpers/database.js';

let db: Database;
beforeAll(async () => {
  db = await testDatabase();
  await db.query("INSERT INTO installations(id,account) VALUES(1,'a'),(2,'b')");
  await db.query(
    "INSERT INTO repositories(id,installation_id,full_name) VALUES(1,1,'a/public'),(2,2,'b/private')",
  );
});
afterAll(async () => {
  await db.close();
});
const secret = 'webhook-test-secret'.repeat(2),
  raw = Buffer.from(
    JSON.stringify({
      action: 'opened',
      installation: { id: 1 },
      repository: { id: 1, full_name: 'a/public' },
      issue: { number: 1 },
    }),
  );
const signature = createHmac('sha256', secret).update(raw).digest('hex');
it('validates exact raw bytes and rejects malformed signatures', () => {
  expect(verifySignature(raw, `sha256=${signature}`, secret)).toBe(true);
  expect(verifySignature(Buffer.concat([raw, Buffer.from(' ')]), `sha256=${signature}`, secret)).toBe(false);
  expect(verifySignature(raw, 'sha256=no', secret)).toBe(false);
});
it('atomically deduplicates webhook deliveries and jobs', async () => {
  const headers = { signature: `sha256=${signature}`, delivery: 'test-delivery', event: 'issues' };
  expect(await acceptWebhook(db, raw, headers, secret)).toMatchObject({ duplicate: false });
  expect(await acceptWebhook(db, raw, headers, secret)).toMatchObject({ duplicate: true });
  expect(
    await acceptWebhook(db, raw, { ...headers, delivery: 'fabricated-delivery-id' }, secret),
  ).toMatchObject({ duplicate: true });
  expect((await db.query("SELECT * FROM jobs WHERE dedupe_key='delivery:test-delivery'")).rows).toHaveLength(
    1,
  );
});
it('does not persist invalid signatures', async () => {
  await expect(
    acceptWebhook(
      db,
      raw,
      { signature: `sha256=${'0'.repeat(64)}`, delivery: 'invalid', event: 'issues' },
      secret,
    ),
  ).rejects.toThrow();
  expect((await db.query("SELECT * FROM webhook_deliveries WHERE id='invalid'")).rows).toHaveLength(0);
});
it('leases jobs, records completion, and fences stale workers', async () => {
  const job = await claim(db);
  expect(job).toBeDefined();
  if (!job) throw new Error('Missing job');
  await finish(db, job, { ok: true });
  await expect(finish(db, job, { again: true })).rejects.toThrow('no longer owns');
  expect((await db.query('SELECT * FROM job_history WHERE job_id=$1', [job.id])).rows).toHaveLength(2);
});
it('retries failures with delay and supports queued cancellation', async () => {
  await enqueue(db, 'repository.index', {}, 1, 'retry-test');
  const job = await claim(db);
  if (!job) throw new Error('Missing job');
  await finish(db, job, undefined, 'TRANSIENT');
  expect((await db.query('SELECT status FROM jobs WHERE id=$1', [job.id])).rows[0]?.status).toBe('queued');
  expect(await cancel(db, job.id)).toBe(true);
});
it('encrypts tokens with integrity and unique nonces', () => {
  const key = 'ab'.repeat(32),
    a = encryptToken('secret', key),
    b = encryptToken('secret', key);
  expect(a).not.toBe(b);
  expect(decryptToken(a, key)).toBe('secret');
  expect(() => decryptToken(a, 'cd'.repeat(32))).toThrow();
});
async function server(writable = true) {
  return createServer({
    db,
    webhookSecret: secret,
    dashboardUrl: 'http://localhost:3000',
    auth: {
      identify: async () => ({ id: 1, login: 'ada', token: 'test' }),
      access: async () => ({ repositoryIds: [1], writableIds: writable ? [1] : [] }),
    },
  });
}
it('filters lists and hides inaccessible repository existence', async () => {
  const app = await server();
  try {
    const list = await app.inject('/api/repositories');
    expect(list.json().data.map((r: { full_name: string }) => r.full_name)).toEqual(['a/public']);
    expect((await app.inject('/api/repositories/b/private')).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
it('rejects writes from readers and foreign origins', async () => {
  const app = await server(false);
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/a/public/analyze',
      headers: { origin: 'http://localhost:3000' },
    });
    expect(response.statusCode).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/repositories/a/public/analyze',
          headers: { origin: 'https://evil.example' },
        })
      ).statusCode,
    ).toBe(403);
  } finally {
    await app.close();
  }
});
it('rejects invalid pagination and unknown configuration fields', async () => {
  const app = await server();
  try {
    expect((await app.inject('/api/repositories?limit=100000')).statusCode).toBe(400);
    expect(
      (
        await app.inject({
          method: 'PUT',
          url: '/api/repositories/a/public/config',
          headers: { origin: 'http://localhost:3000' },
          payload: { version: 1, shell: 'echo unsafe' },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
it('hides jobs in other repositories', async () => {
  const id = await enqueue(db, 'repository.index', {}, 2);
  const app = await server();
  try {
    expect((await app.inject(`/api/jobs/${id}`)).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
it('rejects unauthenticated API requests', async () => {
  const identify = vi.fn().mockRejectedValue(new Error('secret should not be exposed'));
  const app = await createServer({
    db,
    webhookSecret: secret,
    dashboardUrl: 'http://localhost:3000',
    auth: { identify, access: async () => ({ repositoryIds: [], writableIds: [] }) },
  });
  try {
    const response = await app.inject('/api/repositories');
    expect(response.body).not.toContain('secret should');
  } finally {
    await app.close();
  }
});
it('previews unsaved rules without creating jobs, saving config, or enabling writes', async () => {
  const app = await server(false);
  const before = (await db.query('SELECT count(*)::int AS count FROM jobs')).rows[0];
  const config = parseConfig(
    'version: 1\ndryRun: false\nrules:\n  - id: large\n    when: pull_request.opened\n    if:\n      - field: changedFiles\n        operator: gt\n        value: 50\n    then:\n      - type: addLabel\n        value: large',
  );
  const savedBefore = (await db.query('SELECT config FROM repositories WHERE id=1')).rows[0];
  try {
    const response = await app.inject({
      method: 'POST',
      url: '/api/repositories/a/public/automations/preview',
      headers: { origin: 'http://localhost:3000' },
      payload: { trigger: 'pull_request.opened', facts: { changedFiles: 60 }, config },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().plans).toHaveLength(1);
    expect(response.json().plans[0].dryRun).toBe(true);
    expect(response.json().evaluations[0].conditions[0].matched).toBe(true);
    const noMatch = await app.inject({
      method: 'POST',
      url: '/api/repositories/a/public/automations/preview',
      headers: { origin: 'http://localhost:3000' },
      payload: { trigger: 'pull_request.opened', facts: { changedFiles: 2 }, config },
    });
    expect(noMatch.json().plans).toHaveLength(0);
    expect((await db.query('SELECT count(*)::int AS count FROM jobs')).rows[0]).toEqual(before);
    expect((await db.query('SELECT config FROM repositories WHERE id=1')).rows[0]).toEqual(savedBefore);
  } finally {
    await app.close();
  }
});
it('scopes rule previews and rejects unrecognized facts', async () => {
  const app = await server();
  try {
    const request = {
      method: 'POST' as const,
      headers: { origin: 'http://localhost:3000' },
      payload: { trigger: 'issues.opened', facts: {} },
    };
    expect(
      (await app.inject({ ...request, url: '/api/repositories/b/private/automations/preview' })).statusCode,
    ).toBe(404);
    expect(
      (
        await app.inject({
          ...request,
          url: '/api/repositories/a/public/automations/preview',
          payload: { trigger: 'issues.opened', facts: { shell: 'arbitrary' } },
        })
      ).statusCode,
    ).toBe(400);
  } finally {
    await app.close();
  }
});
it('returns stored duplicate candidates only in the authorized issue scope', async () => {
  await db.query("INSERT INTO issues(repository_id,number,data) VALUES(1,91,'{}'),(2,91,'{}')");
  await db.query(
    "INSERT INTO analyses(repository_id,kind,subject,fingerprint,result) VALUES(1,'issue.duplicates','91','fixture',$1)",
    [JSON.stringify({ candidates: [{ number: 92, score: 0.8 }], scope: 'fixture' })],
  );
  const app = await server();
  try {
    expect(
      (await app.inject('/api/issues/a/public/91/duplicates')).json().data.result.candidates[0].number,
    ).toBe(92);
    expect((await app.inject('/api/issues/b/private/91/duplicates')).statusCode).toBe(404);
    expect((await app.inject('/api/issues/a/public/999/duplicates')).statusCode).toBe(404);
  } finally {
    await app.close();
  }
});
it('lists job repository names and permits cancellation only for writable queued jobs', async () => {
  const id = await enqueue(db, 'repository.index', {}, 1),
    app = await server(),
    reader = await server(false);
  const request = {
    method: 'POST' as const,
    url: `/api/jobs/${id}/cancel`,
    headers: { origin: 'http://localhost:3000' },
  };
  try {
    expect((await reader.inject(request)).statusCode).toBe(403);
    const jobs = (await app.inject('/api/jobs')).json().data as { id: string; full_name: string }[];
    expect(jobs.find((j) => j.id === id)?.full_name).toBe('a/public');
    expect((await app.inject(request)).statusCode).toBe(200);
    expect((await app.inject(request)).statusCode).toBe(409);
  } finally {
    await app.close();
    await reader.close();
  }
});
