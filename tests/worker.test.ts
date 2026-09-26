import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { createProcessor } from '../apps/worker/src/processor.js';
import { OpenAIProvider } from '../packages/ai/src/index.js';
import { configSchema } from '../packages/config/src/index.js';
import type { Database, Job } from '../packages/database/src/index.js';
import { GitHubClient } from '../packages/github/src/index.js';
import { testDatabase } from './helpers/database.js';

let db: Database;
const network = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
const gh = new GitHubClient({
  token: async () => {
    throw new Error('External GitHub requests forbidden in this test');
  },
  fetch: network,
});
const github = { app: gh, installation: () => gh };
const job = (id: string, kind: Job['kind'], payload: Record<string, unknown> = {}): Job => ({
  id,
  kind,
  payload,
  repository_id: 1,
  attempts: 1,
  max_attempts: 5,
  lease_token: 'test',
  status: 'running',
});
beforeAll(async () => {
  db = await testDatabase();
  await db.query("INSERT INTO installations(id,account) VALUES(1,'a')");
  await db.query("INSERT INTO repositories(id,installation_id,full_name) VALUES(1,1,'a/b')");
});
afterAll(async () => db.close());
it('queues dry-run scheduled policies using the approved rule table', async () => {
  const config = configSchema.parse({
    version: 1,
    rules: [
      // biome-ignore lint/suspicious/noThenProperty: declarative action array, not a promise.
      { id: 'notify', when: 'scheduled.scan', then: [{ type: 'sendNotification', value: 'Scan completed' }] },
    ],
  });
  await db.query('UPDATE repositories SET config=$1 WHERE id=1', [JSON.stringify(config)]);
  await db.query("INSERT INTO automation_rules(repository_id,id,rule) VALUES(1,'notify',$1)", [
    JSON.stringify(config.rules[0]),
  ]);
  const processor = createProcessor({ db, github, demo: true, demoSource: [], allowWrites: false });
  await processor(job('scheduled', 'scheduled.scan'), new AbortController().signal);
  const result = await db.query<{ payload: { plan: { dryRun: boolean } } }>(
    "SELECT payload FROM jobs WHERE kind='automation.execute'",
  );
  expect(result.rows[0]?.payload.plan.dryRun).toBe(true);
  expect(network).not.toHaveBeenCalled();
});
it('rejects plans whose approved action changed after queueing', async () => {
  const processor = createProcessor({ db, github, demo: true, allowWrites: false });
  const plan = { ruleId: 'notify', actions: [{ type: 'createIssue', title: 'Injected', body: '' }] };
  await expect(
    processor(job('changed', 'automation.execute', { plan }), new AbortController().signal),
  ).rejects.toThrow('changed or was disabled');
  expect(network).not.toHaveBeenCalled();
});
it('requires repository opt-in for AI and prevents replay after a reserved provider request', async () => {
  const fetcher = vi.fn<typeof fetch>().mockImplementation(
    async () =>
      new Response(
        JSON.stringify({
          status: 'completed',
          output: [
            {
              content: [
                {
                  type: 'output_text',
                  text: JSON.stringify({ summary: 'Review findings', suggestions: [], caveats: [] }),
                },
              ],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 20 },
        }),
      ),
  );
  const ai = new OpenAIProvider({ apiKey: 'fixture', model: 'fixture', fetch: fetcher });
  const processor = createProcessor({ db, github, ai, allowWrites: false });
  const task = job('advice-request', 'ai.analyze', { workflow: 'maintainer-report', subject: 'repository' });
  await expect(processor(task, new AbortController().signal)).rejects.toThrow('opt-in');
  await db.query('UPDATE repositories SET config=$1 WHERE id=1', [
    JSON.stringify(configSchema.parse({ version: 1, ai: { enabled: true } })),
  ]);
  const answer = await processor(task, new AbortController().signal);
  expect(answer).toMatchObject({ advisory: true });
  await expect(processor(task, new AbortController().signal)).rejects.toThrow('already reserved');
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await db.query('SELECT input_tokens,output_tokens FROM ai_usage')).rows[0]).toEqual({
    input_tokens: 10,
    output_tokens: 20,
  });
});
it('honors notification opt-out and deduplicates stored notifications', async () => {
  const processor = createProcessor({ db, github, demo: true, allowWrites: false });
  await db.query('UPDATE repositories SET config=$1 WHERE id=1', [
    JSON.stringify(configSchema.parse({ version: 1, notifications: { dashboard: false } })),
  ]);
  const task = job('notify-once', 'notification.send', { message: 'Maintenance note' });
  expect(await processor(task, new AbortController().signal)).toMatchObject({ disabled: true });
  await db.query('UPDATE repositories SET config=$1 WHERE id=1', [
    JSON.stringify(configSchema.parse({ version: 1 })),
  ]);
  await processor(task, new AbortController().signal);
  await processor(task, new AbortController().signal);
  expect((await db.query('SELECT id FROM notifications')).rows).toHaveLength(1);
});
