import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { claim, connect, enqueue, finish, migrate } from '../packages/database/src/index.js';

if (!process.env.TEST_DATABASE_URL)
  throw new Error('Set TEST_DATABASE_URL to a disposable PostgreSQL database; never use production');
const admin = connect(process.env.TEST_DATABASE_URL),
  schema = `om_test_${randomBytes(8).toString('hex')}`;
// schema is entirely generated above, never supplied by a user.
await admin.query(`CREATE SCHEMA "${schema}"`);
const url = new URL(process.env.TEST_DATABASE_URL);
url.searchParams.set('options', `-csearch_path=${schema}`);
const db = connect(url.toString()),
  second = connect(url.toString());
try {
  await migrate(db, resolve('packages/database/migrations/001_initial.sql'));
  await migrate(second, resolve('packages/database/migrations/001_initial.sql'));
  await db.query("INSERT INTO installations(id,account) VALUES(1,'integration')");
  await db.query("INSERT INTO repositories(id,installation_id,full_name) VALUES(1,1,'integration/test')");
  const a = await enqueue(db, 'repository.index', {}, 1, 'one');
  assert.equal(await enqueue(second, 'repository.index', {}, 1, 'one'), a);
  await enqueue(db, 'repository.index', {}, 1, 'two');
  const jobs = await Promise.all([claim(db), claim(second)]);
  assert.ok(jobs[0] && jobs[1]);
  assert.notEqual(jobs[0].id, jobs[1].id);
  await Promise.all([finish(db, jobs[0], { ok: true }), finish(second, jobs[1], { ok: true })]);
  const finishedJob = jobs[0];
  await assert.rejects(() => finish(second, finishedJob, {}), /no longer owns/);
  await assert.rejects(
    () =>
      db.transaction(async (tx) => {
        await enqueue(tx, 'issue.analyze', { number: 1 }, 1, 'rollback');
        throw new Error('rollback');
      }),
    /rollback/,
  );
  assert.equal((await db.query("SELECT id FROM jobs WHERE dedupe_key='rollback'")).rows.length, 0);
  console.log(
    'PostgreSQL integration passed: migrations, concurrent claims, idempotency, fencing and rollback',
  );
} finally {
  await db.close();
  await second.close();
  await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.close();
}
