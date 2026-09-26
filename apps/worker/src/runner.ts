import type { Database, Job } from '@openmaintainer/database';
import { claim, finish, heartbeat } from '@openmaintainer/database';
import { AppError, sleep } from '@openmaintainer/shared';
import type { Logger } from 'pino';
export async function workOnce(
  db: Database,
  processJob: (job: Job, signal: AbortSignal) => Promise<unknown>,
  logger: Pick<Logger, 'info' | 'error'>,
): Promise<boolean> {
  const job = await claim(db);
  if (!job) return false;
  const controller = new AbortController(),
    start = Date.now();
  const timer = setInterval(() => {
    void heartbeat(db, job)
      .then((valid) => {
        if (!valid) controller.abort();
      })
      .catch(() => controller.abort());
  }, 15000);
  timer.unref();
  try {
    const result = await processJob(job, controller.signal);
    controller.signal.throwIfAborted();
    await finish(db, job, result);
    logger.info(
      { jobId: job.id, repositoryId: job.repository_id, durationMs: Date.now() - start },
      'Job succeeded',
    );
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'JOB_FAILED';
    try {
      await finish(db, job, undefined, code);
    } catch {
      logger.error({ jobId: job.id, code: 'LEASE_LOST' }, 'Result not committed after lease loss');
    }
    logger.error({ jobId: job.id, repositoryId: job.repository_id, code }, 'Job failed');
  } finally {
    clearInterval(timer);
    try {
      await db.query(
        'INSERT INTO metrics(name,value) VALUES($1,$2) ON CONFLICT(name,bucket) DO UPDATE SET value=metrics.value+EXCLUDED.value,count=metrics.count+1',
        [`job.duration-ms.${job.kind}`, Date.now() - start],
      );
    } catch {
      logger.error({ code: 'METRICS' }, 'Could not record worker duration');
    }
  }
  return true;
}
export async function runWorker(
  db: Database,
  processJob: (job: Job, signal: AbortSignal) => Promise<unknown>,
  logger: Pick<Logger, 'info' | 'error'>,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    try {
      if (!(await workOnce(db, processJob, logger))) await sleep(1000);
    } catch {
      logger.error({ code: 'WORKER_POLL' }, 'Worker polling failed');
      await sleep(3000);
    }
  }
}
export async function scheduleMaintenance(db: Database): Promise<void> {
  const bucket = new Date().toISOString().slice(0, 13);
  await db.query(
    "INSERT INTO jobs(id,kind,repository_id,payload,dedupe_key) SELECT md5(r.id::text||$1),'scheduled.scan',r.id,'{}'::jsonb,'scan:'||r.id::text||':'||$1 FROM repositories r JOIN installations i ON i.id=r.installation_id WHERE i.suspended=false AND r.archived=false ON CONFLICT(dedupe_key) DO NOTHING",
    [bucket],
  );
  await db.query(
    "UPDATE webhook_deliveries SET payload=NULL WHERE received_at<now()-interval '7 days' AND status='processed'",
  );
  await db.query('DELETE FROM sessions WHERE expires_at<now()');
  await db.query('DELETE FROM oauth_states WHERE expires_at<now()');
  await db.query(
    "DELETE FROM jobs WHERE status IN('succeeded','cancelled') AND updated_at<now()-interval '30 days'",
  );
  await db.query("DELETE FROM analyses WHERE created_at<now()-interval '90 days'");
  await db.query("DELETE FROM audit_events WHERE created_at<now()-interval '180 days'");
}
