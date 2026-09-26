import type { Action, Config } from '@openmaintainer/config';
import type { DomainEvent, Policy } from '@openmaintainer/core';
import type { Database } from '@openmaintainer/database';
import { audit } from '@openmaintainer/database';
import { evaluateRule } from '@openmaintainer/rule-engine';
import { AppError, digest } from '@openmaintainer/shared';
export interface AutomationPlan {
  id: string;
  event: DomainEvent;
  ruleId: string;
  actions: Action[];
  dryRun: boolean;
}
export function planAutomations(config: Config, event: DomainEvent, policy: Policy): AutomationPlan[] {
  return config.rules
    .filter((r) => evaluateRule(r, event).matched)
    .map((r) => ({
      id: digest([event.repositoryId, event.id, r.id].join(':')),
      event,
      ruleId: r.id,
      actions: r.then.filter((a) => policy.allowedActions.includes(a.type)),
      dryRun: config.dryRun || !policy.allowWrites,
    }));
}
export interface ActionExecutor {
  execute(action: Action, event: DomainEvent, idempotencyKey: string): Promise<unknown>;
}
export async function executePlan(
  db: Database,
  plan: AutomationPlan,
  executor: ActionExecutor,
  signal?: AbortSignal,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.query(
      'INSERT INTO automation_runs(id,repository_id,event_id,rule_id,plan,dry_run,status) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(id) DO NOTHING',
      [
        plan.id,
        plan.event.repositoryId,
        plan.event.id,
        plan.ruleId,
        JSON.stringify(plan),
        plan.dryRun,
        plan.dryRun ? 'dry_run' : 'pending',
      ],
    );
    await audit(
      tx,
      plan.event.actor,
      plan.event.repositoryId,
      'automation.planned',
      plan.dryRun ? 'dry_run' : plan.ruleId,
    );
  });
  const stored = await db.query<{ plan: AutomationPlan; status: string }>(
    'SELECT plan,status FROM automation_runs WHERE id=$1',
    [plan.id],
  );
  const persisted = stored.rows[0];
  if (!persisted) throw new AppError('PLAN_MISSING', 'Automation plan not found');
  if (persisted.status === 'succeeded' || persisted.plan.dryRun || plan.dryRun) return;
  if (JSON.stringify(persisted.plan.actions) !== JSON.stringify(plan.actions))
    throw new AppError('PLAN_CHANGED', 'An event cannot be replayed with changed actions');
  for (const [index, action] of persisted.plan.actions.entries()) {
    signal?.throwIfAborted();
    const key = digest(`${plan.id}:${index}`);
    const claimed = await db.query(
      "INSERT INTO action_ledger(id,run_id,status) VALUES($1,$2,'started') ON CONFLICT(id) DO NOTHING RETURNING id",
      [key, plan.id],
    );
    if (!claimed.rows.length) {
      const previous = await db.query<{ status: string }>('SELECT status FROM action_ledger WHERE id=$1', [
        key,
      ]);
      if (previous.rows[0]?.status === 'succeeded') continue;
      await db.query("UPDATE automation_runs SET status='needs_attention' WHERE id=$1", [plan.id]);
      throw new AppError('ACTION_UNKNOWN', 'Previous action outcome requires manual reconciliation', 409);
    }
    try {
      await executor.execute(action, plan.event, key);
      await db.transaction(async (tx) => {
        await tx.query("UPDATE action_ledger SET status='succeeded',updated_at=now() WHERE id=$1", [key]);
        await audit(tx, 'automation', plan.event.repositoryId, action.type, 'succeeded');
      });
    } catch (error) {
      await db.transaction(async (tx) => {
        await tx.query("UPDATE action_ledger SET status='unknown',updated_at=now() WHERE id=$1", [key]);
        await tx.query("UPDATE automation_runs SET status='needs_attention' WHERE id=$1", [plan.id]);
        await audit(tx, 'automation', plan.event.repositoryId, action.type, 'unknown');
      });
      throw error;
    }
  }
  await db.query("UPDATE automation_runs SET status='succeeded' WHERE id=$1", [plan.id]);
}
export function renderTemplate(template: string, event: DomainEvent): string {
  const sanitize = (value: string) => value.replace(/[@<>]/g, '').replace(/[\r\n]/g, ' ');
  const variables: Record<string, string> = {
    author: event.actor,
    repository: event.repository,
    number: String(event.subjectNumber ?? ''),
  };
  return template.replace(/\{\{\s*(author|repository|number)\s*\}\}/g, (_, key: string) =>
    sanitize(variables[key] ?? ''),
  );
}
