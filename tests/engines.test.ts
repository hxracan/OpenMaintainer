import { expect, it, vi } from 'vitest';
import { executePlan, planAutomations } from '../packages/automation-engine/src/index.js';
import { analyzeCi } from '../packages/ci-analysis/src/index.js';
import { parseConfig } from '../packages/config/src/index.js';
import type { DomainEvent } from '../packages/core/src/index.js';
import { parseChangeset, prepareRelease, validateRelease } from '../packages/release-engine/src/index.js';
import { evaluateCondition } from '../packages/rule-engine/src/index.js';
import { testDatabase } from './helpers/database.js';

const event: DomainEvent = {
  id: 'evt',
  trigger: 'pull_request.opened',
  repository: 'a/b',
  repositoryId: 1,
  installationId: 1,
  actor: 'ada',
  subjectNumber: 1,
  facts: { changedFiles: 60, paths: ['src/auth.ts'] },
};
it('matches bounded globs and fails closed on absent facts', () => {
  expect(evaluateCondition({ field: 'paths', operator: 'matches', value: 'src/**' }, event).matched).toBe(
    true,
  );
  expect(evaluateCondition({ field: 'author', operator: 'neq', value: 'bot' }, event).matched).toBe(false);
});
it('defaults automation to dry-run', () => {
  const config = parseConfig(
    'version: 1\nrules:\n  - id: large\n    when: pull_request.opened\n    if: []\n    then:\n      - type: addLabel\n        value: large-pr',
  );
  expect(planAutomations(config, event, { allowWrites: true, allowedActions: ['addLabel'] })[0]?.dryRun).toBe(
    true,
  );
});
it('records actions once and never blindly retries ambiguous writes', async () => {
  const db = await testDatabase();
  try {
    await db.query("INSERT INTO installations(id,account) VALUES(1,'a')");
    await db.query("INSERT INTO repositories(id,installation_id,full_name) VALUES(1,1,'a/b')");
    const execute = vi.fn().mockResolvedValue({});
    const plan = {
      id: 'plan',
      event,
      ruleId: 'rule',
      actions: [{ type: 'addLabel' as const, value: 'large' }],
      dryRun: false,
    };
    await executePlan(db, plan, { execute });
    await executePlan(db, plan, { execute });
    expect(execute).toHaveBeenCalledTimes(1);
    const failed = { ...plan, id: 'failed', event: { ...event, id: 'evt2' } };
    execute.mockRejectedValueOnce(new Error('connection lost'));
    await expect(executePlan(db, failed, { execute })).rejects.toThrow('connection lost');
    await expect(executePlan(db, failed, { execute })).rejects.toThrow('reconciliation');
    expect(execute).toHaveBeenCalledTimes(2);
  } finally {
    await db.close();
  }
});
it('groups CI diagnoses and redacts tokens', () => {
  const r = analyzeCi('Authorization: Bearer abc\nerror TS2322: bad type\nerror TS2322: another');
  expect(r.groups[0]?.occurrences).toBe(2);
  expect(JSON.stringify(r)).not.toContain('Bearer abc');
});
it('prepares semver releases without publishing', () => {
  const r = prepareRelease('1.2.3', [{ sha: 'abc1234', message: 'feat!: remove legacy API' }], [], 1);
  expect(r.version).toBe('2.0.0-rc.1');
  expect(r.published).toBe(false);
  expect(validateRelease('1.2.3', 'notes', ['v1.2.3'])).toEqual(['Version already exists']);
});
it('parses changesets without arbitrary tags', () => {
  expect(() => parseChangeset('---\na: !custom minor\n---\nb')).toThrow();
  expect(parseChangeset('---\n"@scope/pkg": minor\n---\nAdd endpoint').packages['@scope/pkg']).toBe('minor');
  expect(() => parseChangeset('---\na: &a [*a]\n---\nb')).toThrow();
});
