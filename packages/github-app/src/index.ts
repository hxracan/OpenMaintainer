import { createHmac, timingSafeEqual } from 'node:crypto';
import type { DomainEvent } from '@openmaintainer/core';
import type { Database } from '@openmaintainer/database';
import { audit, enqueue } from '@openmaintainer/database';
import { AppError, asRecord, digest, numeric, repositoryName, textField } from '@openmaintainer/shared';
import { z } from 'zod';
export const supportedEvents = new Set([
  'issues',
  'issue_comment',
  'pull_request',
  'pull_request_review',
  'pull_request_review_comment',
  'push',
  'release',
  'workflow_run',
  'workflow_job',
  'check_run',
  'repository',
  'installation',
  'installation_repositories',
]);
export function verifySignature(raw: Buffer, signature: string | undefined, secret: string): boolean {
  if (!secret || !signature || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const expected = createHmac('sha256', secret).update(raw).digest(),
    actual = Buffer.from(signature.slice(7), 'hex');
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
export async function acceptWebhook(
  db: Database,
  raw: Buffer,
  headers: { signature?: string; delivery?: string; event?: string },
  secret: string,
) {
  if (!verifySignature(raw, headers.signature, secret))
    throw new AppError('WEBHOOK_SIGNATURE', 'Invalid webhook signature', 401);
  const id = z
    .string()
    .regex(/^[A-Za-z0-9-]{1,100}$/)
    .parse(headers.delivery);
  const event = z.string().max(100).parse(headers.event);
  if (!supportedEvents.has(event)) return { accepted: false, ignored: true };
  let payload: Record<string, unknown>;
  try {
    payload = asRecord(JSON.parse(raw.toString('utf8')));
  } catch {
    throw new AppError('WEBHOOK_JSON', 'Malformed JSON');
  }
  const repository = asRecord(payload.repository),
    installation = asRecord(payload.installation);
  const installationId = numeric(installation.id) || null,
    repositoryId = numeric(repository.id) || null;
  return db.transaction(async (tx) => {
    const inserted = await tx.query(
      'INSERT INTO webhook_deliveries(id,event,repository_id,installation_id,payload,payload_hash) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING RETURNING id',
      [id, event, repositoryId, installationId, JSON.stringify(payload), digest(raw.toString('utf8'))],
    );
    if (!inserted.rows.length) return { accepted: true, duplicate: true };
    const jobId = await enqueue(tx, 'webhook.process', { deliveryId: id }, null, `delivery:${id}`);
    await audit(tx, 'github', repositoryId, 'webhook.accepted', id);
    return { accepted: true, duplicate: false, jobId };
  });
}
export function toDomainEvent(
  id: string,
  event: string,
  payload: Record<string, unknown>,
): DomainEvent | undefined {
  const repository = asRecord(payload.repository),
    installation = asRecord(payload.installation),
    pr = asRecord(payload.pull_request),
    issue = asRecord(payload.issue),
    run = asRecord(payload.workflow_run),
    sender = asRecord(payload.sender),
    subject = Object.keys(pr).length ? pr : issue;
  if (!repository.id || !installation.id) return undefined;
  const labels = Array.isArray(subject.labels)
    ? subject.labels.map((l) => textField(asRecord(l).name)).filter(Boolean)
    : [];
  const action =
    event === 'workflow_run' && payload.action === 'completed'
      ? textField(run.conclusion)
      : textField(payload.action);
  const facts: DomainEvent['facts'] = {
    author: textField(asRecord(subject.user).login) || textField(sender.login),
    labels,
    branch:
      textField(asRecord(pr.base).ref) || textField(run.head_branch) || textField(repository.default_branch),
  };
  if (typeof pr.changed_files === 'number') facts.changedFiles = pr.changed_files;
  if (typeof pr.additions === 'number') facts.additions = pr.additions;
  if (typeof pr.deletions === 'number') facts.deletions = pr.deletions;
  if (run.conclusion) facts.ciStatus = textField(run.conclusion);
  if (repository.language) facts.language = textField(repository.language);
  if (subject.created_at)
    facts.issueAgeDays = Math.max(0, (Date.now() - Date.parse(textField(subject.created_at))) / 86400000);
  if (subject.author_association)
    facts.firstTimeContributor = ['FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR'].includes(
      textField(subject.author_association),
    );
  return {
    id,
    trigger: `${event}.${action}`,
    repository: repositoryName.parse(repository.full_name),
    repositoryId: numeric(repository.id),
    installationId: numeric(installation.id),
    actor: textField(sender.login),
    subjectNumber: numeric(subject.number) || undefined,
    facts,
  };
}
