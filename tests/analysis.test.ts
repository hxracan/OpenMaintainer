import { expect, it } from 'vitest';
import type { Issue } from '../packages/core/src/index.js';
import { analyzeIssue, findDuplicates } from '../packages/issue-triage/src/index.js';
import { analyzePullRequest } from '../packages/pr-analysis/src/index.js';
import { analyzeRepository, repositoryHealth } from '../packages/repository-analysis/src/index.js';

it('detects monorepo tooling and explains missing files', () => {
  const p = analyzeRepository([
    {
      path: 'package.json',
      content: JSON.stringify({
        workspaces: ['packages/*'],
        dependencies: { react: '19' },
        devDependencies: { vitest: '5', turbo: '2' },
      }),
    },
    { path: 'pnpm-lock.yaml', content: '' },
    { path: 'src/index.ts', content: 'export const x=1' },
  ]);
  expect(p.frameworks).toEqual(['react']);
  expect(p.testFrameworks).toEqual(['vitest']);
  expect(p.packageManagers).toEqual(['pnpm']);
  expect(p.workspaces).toEqual(['packages/*']);
  expect(p.findings.some((f) => f.ruleId === 'repository.missing-security')).toBe(true);
});
it('finds removed exports and signature changes using syntax trees', () => {
  const result = analyzePullRequest([
    {
      path: 'src/index.ts',
      status: 'modified',
      additions: 1,
      deletions: 2,
      before: 'export function old(a:string){}; export function f(x:string){}',
      after: 'export function f(x:number,y:string){}',
    },
  ]);
  expect(result.findings.map((f) => f.ruleId)).toContain('breaking.removed-export');
  expect(result.findings.map((f) => f.ruleId)).toContain('breaking.signature');
  expect(result.risk).toBe('high');
});
it('does not treat comment text as an exported declaration', () => {
  const r = analyzePullRequest([
    {
      path: 'src/a.ts',
      status: 'modified',
      additions: 0,
      deletions: 1,
      before: '// export function old(){}',
      after: '',
    },
  ]);
  expect(r.findings.some((f) => f.ruleId.startsWith('breaking.'))).toBe(false);
});
const issue: Issue = {
  number: 1,
  title: 'Crash when importing a module',
  body: 'The import fails',
  author: 'ada',
  labels: ['bug'],
  createdAt: '2025-01-01',
  updatedAt: '2025-01-01',
  state: 'open',
};
it('triages missing reproduction without closing issues', () => {
  const r = analyzeIssue(issue, { now: new Date('2026-01-01') });
  expect(r.category).toBe('bug');
  expect(r.automaticClosure).toBe(false);
  expect(r.findings.map((f) => f.ruleId)).toContain('issue.reproduction');
});
it('ranks duplicates and excludes itself', () => {
  const results = findDuplicates(issue, [
    issue,
    { ...issue, number: 2 },
    { ...issue, number: 3, title: 'Support a new theme', body: 'Different colors', labels: [] },
  ]);
  expect(results.map((r) => r.number)).toEqual([2]);
});
it('marks unavailable health signals unknown', () => {
  const r = repositoryHealth({
    profile: analyzeRepository([]),
    openPullRequests: [],
    openIssues: [],
    defaultBranchCi: 'unknown',
  });
  expect(r.signals.defaultBranchFailing).toBeNull();
  expect(r.signals.outdatedDependencies).toBeNull();
});
