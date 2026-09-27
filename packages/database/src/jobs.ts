import type { JobKind } from '@openmaintainer/core';
import { AppError, opaqueId } from '@openmaintainer/shared';
import type { Database, Row, Sql } from './index.js';
export interface Job extends Row {
  id: string;
  kind: JobKind;
  repository_id: number | null;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
  lease_token: string;
  status: string;
}
export async function enqueue(
  db: Sql,
  kind: JobKind,
  payload: Record<string, unknown>,
  repositoryId: number | null = null,
  dedupeKey?: string,
): Promise<string> {
  const id = opaqueId();
  const r = await db.query<{ id: string }>(
    'INSERT INTO jobs(id,kind,payload,repository_id,dedupe_key) VALUES($1,$2,$3,$4,$5) ON CONFLICT(dedupe_key) DO UPDATE SET dedupe_key=EXCLUDED.dedupe_key RETURNING id',
    [id, kind, JSON.stringify(payload), repositoryId, dedupeKey ?? null],
  );
  const job = r.rows[0];
  if (!job) throw new AppError('QUEUE_WRITE', 'Failed to enqueue job', 500);
  return job.id;
}
export async function claim(db: Database): Promise<Job | undefined> {
  return db.transaction(async (tx) => {
    const expired = await tx.query<{ id: string; status: string }>(
      "UPDATE jobs SET status=CASE WHEN attempts>=max_attempts THEN 'dead' ELSE 'queued' END,lease_token=NULL,lease_until=NULL,error_code='LEASE_EXPIRED',updated_at=now() WHERE status='running' AND lease_until<now() RETURNING id,status",
    );
    for (const row of expired.rows)
      await tx.query('INSERT INTO job_history(job_id,status,detail) VALUES($1,$2,$3)', [
        row.id,
        row.status,
        'Lease expired',
      ]);
    const token = opaqueId();
    const result = await tx.query<Job>(
      "WITH candidate AS (SELECT id FROM jobs WHERE status='queued' AND available_at<=now() ORDER BY available_at,created_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE jobs SET status='running',attempts=attempts+1,lease_token=$1,lease_until=now()+interval '60 seconds',updated_at=now() WHERE id=(SELECT id FROM candidate) RETURNING *",
      [token],
    );
    const job = result.rows[0];
    if (job) await tx.query("INSERT INTO job_history(job_id,status) VALUES($1,'running')", [job.id]);
    return job;
  });
}
export async function heartbeat(db: Sql, job: Job): Promise<boolean> {
  const r = await db.query(
    "UPDATE jobs SET lease_until=now()+interval '60 seconds' WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() RETURNING id",
    [job.id, job.lease_token],
  );
  return r.rows.length === 1;
}
export async function finish(db: Database, job: Job, result: unknown, errorCode?: string): Promise<void> {
  const status = errorCode
    ? job.attempts >= job.max_attempts ||
      [
        'ACTION_UNKNOWN',
        'CONFIG_SCHEMA',
        'VALIDATION',
        'NOT_FOUND',
        'AI_FAILED',
        'AI_DISABLED',
        'AI_WORKFLOW',
        'AI_EVIDENCE',
        'AI_BUDGET',
        'PLAN_CHANGED',
        'DEMO',
      ].includes(errorCode)
      ? 'dead'
      : 'queued'
    : 'succeeded';
  await db.transaction(async (tx) => {
    const done = await tx.query(
      "UPDATE jobs SET status=$3,result=$4,error_code=$5,lease_token=NULL,lease_until=NULL,available_at=now()+($6*interval '1 second'),updated_at=now() WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>now() RETURNING id",
      [
        job.id,
        job.lease_token,
        status,
        result === undefined ? null : JSON.stringify(result),
        errorCode ?? null,
        Math.min(3600, 2 ** job.attempts * 5),
      ],
    );
    if (!done.rows.length) throw new AppError('LEASE_LOST', 'Worker no longer owns job', 409);
    await tx.query('INSERT INTO job_history(job_id,status,detail) VALUES($1,$2,$3)', [
      job.id,
      status,
      errorCode ?? null,
    ]);
  });
}
export async function cancel(db: Sql, id: string): Promise<boolean> {
  return (
    (
      await db.query(
        "WITH cancelled AS (UPDATE jobs SET status='cancelled',updated_at=now() WHERE id=$1 AND status='queued' RETURNING id) INSERT INTO job_history(job_id,status) SELECT id,'cancelled' FROM cancelled RETURNING job_id",
        [id],
      )
    ).rows.length === 1
  );
}
