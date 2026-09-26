import { planAutomations } from '@openmaintainer/automation-engine';
import { type Config, configSchema, defaultConfig, ruleSchema } from '@openmaintainer/config';
import type { DomainEvent } from '@openmaintainer/core';
import type { Database } from '@openmaintainer/database';
import { audit, enqueue } from '@openmaintainer/database';
import { type GitHubClient, pullRequestSource } from '@openmaintainer/github';
import { toDomainEvent } from '@openmaintainer/github-app';
import { analyzePullRequest } from '@openmaintainer/pr-analysis';
import { AppError, asRecord, numeric, textField } from '@openmaintainer/shared';
export interface GitHubServices {
  app: GitHubClient;
  installation: (id: number, repositoryIds?: number[]) => GitHubClient;
}
export async function syncInstallation(db: Database, services: GitHubServices, id: number): Promise<void> {
  let installation: Record<string, unknown>;
  try {
    installation = await services.app.request(`/app/installations/${id}`);
  } catch (error) {
    if (error instanceof AppError && error.status === 404) {
      await db.query('DELETE FROM installations WHERE id=$1', [id]);
      return;
    }
    throw error;
  }
  const suspended = Boolean(installation.suspended_at);
  await db.query(
    'INSERT INTO installations(id,account,suspended) VALUES($1,$2,$3) ON CONFLICT(id) DO UPDATE SET account=EXCLUDED.account,suspended=EXCLUDED.suspended,updated_at=now()',
    [id, textField(asRecord(installation.account).login), suspended],
  );
  if (suspended) return;
  const gh = services.installation(id),
    repos: Record<string, unknown>[] = [];
  for (let page = 1; page <= 100; page++) {
    const response = await gh.request<{ repositories: Record<string, unknown>[] }>(
      `/installation/repositories?per_page=100&page=${page}`,
    );
    repos.push(...response.repositories);
    if (response.repositories.length < 100) break;
    if (page === 100)
      throw new AppError('INSTALLATION_LIMIT', 'Installation exceeds supported repository count');
  }
  await db.transaction(async (tx) => {
    for (const repo of repos)
      await tx.query(
        'INSERT INTO repositories(id,installation_id,full_name,default_branch,private,archived,snapshot) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO UPDATE SET full_name=EXCLUDED.full_name,installation_id=EXCLUDED.installation_id,default_branch=EXCLUDED.default_branch,private=EXCLUDED.private,archived=EXCLUDED.archived,snapshot=EXCLUDED.snapshot,updated_at=now()',
        [
          numeric(repo.id),
          id,
          textField(repo.full_name),
          textField(repo.default_branch),
          Boolean(repo.private),
          Boolean(repo.archived),
          JSON.stringify(repo),
        ],
      );
    await tx.query('DELETE FROM repositories WHERE installation_id=$1 AND NOT(id=ANY($2::bigint[]))', [
      id,
      repos.map((r) => numeric(r.id)),
    ]);
  });
  for (const repo of repos)
    if (!repo.archived)
      await enqueue(db, 'repository.index', {}, numeric(repo.id), `installation:${id}:${numeric(repo.id)}`);
}
export async function processWebhook(
  db: Database,
  services: GitHubServices,
  deliveryId: string,
  allowWrites: boolean,
): Promise<void> {
  const delivery = (
    await db.query<{ event: string; payload: Record<string, unknown>; status: string }>(
      'SELECT event,payload,status FROM webhook_deliveries WHERE id=$1',
      [deliveryId],
    )
  ).rows[0];
  if (!delivery?.payload) throw new AppError('NOT_FOUND', 'Webhook payload not retained', 404);
  const installationId = numeric(asRecord(delivery.payload.installation).id);
  if (!installationId) {
    await db.query("UPDATE webhook_deliveries SET status='ignored',processed_at=now() WHERE id=$1", [
      deliveryId,
    ]);
    return;
  }
  if (
    ['installation', 'installation_repositories', 'repository'].includes(delivery.event) ||
    !(await db.query('SELECT id FROM installations WHERE id=$1', [installationId])).rows.length
  )
    await syncInstallation(db, services, installationId);
  const event = toDomainEvent(deliveryId, delivery.event, delivery.payload);
  if (event) {
    const row = (
      await db.query<{ config: unknown }>(
        'SELECT r.config FROM repositories r JOIN installations i ON i.id=r.installation_id WHERE r.id=$1 AND r.installation_id=$2 AND i.suspended=false AND r.archived=false',
        [event.repositoryId, installationId],
      )
    ).rows[0];
    if (row) {
      const kind =
        delivery.event === 'pull_request'
          ? 'pr.analyze'
          : ['issues', 'issue_comment'].includes(delivery.event)
            ? 'issue.analyze'
            : delivery.event === 'workflow_run'
              ? 'ci.analyze'
              : ['push', 'repository'].includes(delivery.event)
                ? 'repository.index'
                : undefined;
      const number = event.subjectNumber ?? numeric(asRecord(delivery.payload.workflow_run).id);
      if (kind)
        await enqueue(db, kind, number ? { number } : {}, event.repositoryId, `${deliveryId}:${kind}`);
      const config = row.config ? configSchema.parse(row.config) : defaultConfig();
      if (event.trigger.startsWith('pull_request.') && event.subjectNumber) {
        const source = await pullRequestSource(
          services.installation(installationId, [event.repositoryId]),
          event.repository,
          event.subjectNumber,
        );
        // Do not apply an old delivery's rule to a newer PR revision.
        const deliveredHead = textField(asRecord(asRecord(delivery.payload.pull_request).head).sha);
        if (deliveredHead && deliveredHead !== source.head) {
          await audit(db, 'worker', event.repositoryId, 'automation.stale-revision', deliveryId);
        } else {
          const analysis = analyzePullRequest(source.files);
          event.facts.paths = source.files.map((f) => f.path);
          event.facts.testsChanged = analysis.summary.testsChanged > 0;
          event.facts.publicApiChanged = analysis.indicators.publicApiChanged;
          event.facts.dependencyUpdate = analysis.indicators.dependenciesChanged;
          await queueAutomations(db, config, event, allowWrites);
        }
      } else await queueAutomations(db, config, event, allowWrites);
    }
  }
  await db.transaction(async (tx) => {
    await tx.query("UPDATE webhook_deliveries SET status='processed',processed_at=now() WHERE id=$1", [
      deliveryId,
    ]);
    await audit(tx, 'worker', event?.repositoryId ?? null, 'webhook.processed', deliveryId);
  });
}
export async function queueAutomations(
  db: Database,
  config: Config,
  event: DomainEvent,
  allowWrites: boolean,
): Promise<void> {
  const rules = (
    await db.query<{ rule: unknown }>('SELECT rule FROM automation_rules WHERE repository_id=$1', [
      event.repositoryId,
    ])
  ).rows.map((r) => ruleSchema.parse(r.rule));
  for (const plan of planAutomations({ ...config, rules }, event, {
    allowWrites,
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
  })) {
    await enqueue(db, 'automation.execute', { plan }, event.repositoryId, plan.id);
  }
}
