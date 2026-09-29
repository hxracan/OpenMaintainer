import { expect, it } from 'vitest';
import { investigationExample } from '../apps/api/src/investigation-example.js';
import { investigateCi } from '../packages/ci-analysis/src/index.js';
import type { ChangedFile } from '../packages/core/src/index.js';
import { navigateIssue } from '../packages/issue-triage/src/index.js';
import { contractChanges } from '../packages/pr-analysis/src/contracts.js';
import { investigateChanges } from '../packages/pr-analysis/src/investigation.js';
import { regressionPlan } from '../packages/pr-analysis/src/regression.js';

const change = (before: string, after: string, path = 'src/client.ts'): ChangedFile => ({
  path,
  before,
  after,
  status: 'modified',
  additions: 1,
  deletions: 1,
});
it('detects removed exports, required arguments and defaults with exact source evidence', () => {
  const report = contractChanges([
    change(
      '// header\nexport function connect(url: string, retries = 3) { return url; }\nexport const old = 1;',
      '// header\nexport function connect(url: string, token: string, retries = 0) { return url; }',
    ),
  ]);
  expect(report.changes.map((c) => c.kind)).toEqual(
    expect.arrayContaining(['required-parameter', 'changed-default', 'removed-export']),
  );
  const argument = report.changes.find((c) => c.kind === 'required-parameter');
  expect(argument?.evidence.map((e) => e.line)).toEqual([2, 2]);
  expect(argument?.evidence[0]?.text).toContain('retries = 3');
  expect(argument?.evidence[1]?.text).toContain('token: [REDACTED]');
});
it('handles aliases, arrow exports, defaults and required interface fields', () => {
  const report = contractChanges([
    change(
      'const go = (url: string) => url; export { go as connect }; export interface Options { token?: string } export default go;',
      'const go = (url: string, token: string) => url; export { go as connect }; export interface Options { token: string; timeout: number }',
    ),
  ]);
  expect(report.changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: 'required-parameter', symbol: 'connect' }),
      expect.objectContaining({ kind: 'removed-export', symbol: 'default' }),
      expect.objectContaining({ kind: 'required-field', symbol: 'Options.token' }),
      expect.objectContaining({ kind: 'required-field', symbol: 'Options.timeout' }),
    ]),
  );
  expect(report.changes.some((c) => c.kind === 'changed-default')).toBe(false);
});
it('does not report body-only changes, parameter renames or comments as contract changes', () => {
  expect(
    contractChanges([
      change(
        'export function go(url: string): string { return url; }',
        '// comment\nexport function go(input: string): string { return input.trim(); }',
      ),
    ]).changes,
  ).toEqual([]);
});
it('checks declared arrow types and ignores body-only changes in default arrow exports', () => {
  expect(
    contractChanges([
      change(
        'export const fn: (x: string) => string = x => x;',
        'export const fn: (x: number) => number = x => x;',
      ),
    ]).changes[0]?.kind,
  ).toBe('changed-contract');
  expect(
    contractChanges([change('export default (x: string) => x;', 'export default (x: string) => x.trim();')])
      .changes,
  ).toEqual([]);
});
it('compares exported literals, config values and package entrypoints', () => {
  const report = contractChanges([
    change('export const TIMEOUT = 3;', 'export const TIMEOUT = 0;'),
    change('{"timeout":3}', '{"timeout":0}', 'config.json'),
    change('{"exports":"./old.js"}', '{"exports":"./new.js"}', 'package.json'),
  ]);
  expect(report.changes.map((c) => c.kind)).toEqual([
    'changed-exported-value',
    'configuration-default',
    'package-contract',
  ]);
});
it('skips unparseable or absent versions and preserves renamed source paths', () => {
  expect(
    contractChanges([change('export function ???', 'export function ok() {}')]).limitations.join(' '),
  ).toContain('syntax');
  const removed = {
    ...change('export const legacy = 1;', ''),
    status: 'removed' as const,
    previousPath: 'src/old.ts',
  };
  expect(contractChanges([removed]).changes[0]?.evidence[0]?.path).toBe('src/old.ts');
  expect(investigateChanges([{ ...removed, before: undefined }]).coverage.uninspected).toEqual([
    'src/client.ts',
  ]);
});
it('does not count unrelated tests as coverage and finds direct imports separately', () => {
  const source = change('export const n = 1', 'export const n = 2');
  const unrelated = change('', 'test("other", () => {})', 'tests/other.test.ts');
  expect(regressionPlan([source, unrelated], [], ['tests/client.test.ts']).candidates[0]).toMatchObject({
    status: 'related-tests-unchanged',
    changedTests: [],
  });
  const direct = change('', "import { n } from '../src/client.js';", 'tests/integration.test.ts');
  expect(regressionPlan([source, direct], []).candidates[0]?.changedTests).toEqual([
    'tests/integration.test.ts',
  ]);
});
it('correlates exact CI paths with redacted evidence without asserting a cause', () => {
  const result = investigateCi('token="secret-value"\nsrc/client.ts(2,1): error TS2554: wrong arguments', [
    change('', ''),
  ]);
  expect(result.correlations[0]).toMatchObject({ path: 'src/client.ts', logLine: 2 });
  expect(JSON.stringify(result)).not.toContain('secret-value');
  expect(result.correlations[0]?.basis).toContain('not proof');
  expect(investigateCi('', []).supplied).toBe(false);
});
it('ranks exact issue paths and named declarations with reasons and handles no matches', () => {
  const files = [
    { path: 'src/client.ts', content: 'export function connect() {}' },
    { path: 'src/unrelated.ts', content: '' },
  ];
  const result = navigateIssue('connect crashes in src/client.ts', files);
  expect(result.candidates[0]?.path).toBe('src/client.ts');
  expect(result.candidates[0]?.evidence[0]?.symbol).toBe('connect');
  expect(navigateIssue('zebra', files).candidates).toEqual([]);
});
it('combines all five sections and never approves a release or claims CI passed', () => {
  const result = investigationExample();
  expect(result.source.example).toBe(true);
  expect(result.contracts.changes.length).toBeGreaterThan(0);
  expect(result.regression.candidates[0]?.status).toBe('related-tests-unchanged');
  expect(result.ci.correlations).toHaveLength(1);
  expect(result.release.checklist.length).toBeGreaterThan(0);
  expect(result.release.ciStatus).toContain('unknown');
  expect(result.issue.candidates[0]?.path).toBe('src/client.ts');
});
it('enforces source size and path limits', () => {
  expect(() => investigateChanges([change('x'.repeat(250001), '')])).toThrow('size limit');
  expect(() => investigateChanges([change('', '', '../secret')])).toThrow('relative');
});
it('does not correlate filename prefixes as exact CI paths', () => {
  expect(investigateCi('src/client.tsx: error TS2554', [change('', '')]).correlations).toEqual([]);
  expect(
    investigateCi('/runner/project/src/client.ts: error TS2554', [change('', '')]).correlations,
  ).toHaveLength(1);
});
