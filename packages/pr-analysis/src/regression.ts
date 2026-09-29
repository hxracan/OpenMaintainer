import { posix } from 'node:path';
import type { ChangedFile } from '@openmaintainer/core';
import { redact } from '@openmaintainer/shared';
import type { ContractChange, Evidence } from './contracts.js';

export const isTest = (path: string) => /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[^.]+$/.test(path);
const stem = (path: string) =>
  posix
    .basename(path)
    .replace(/\.(test|spec)(?=\.)/, '')
    .replace(/\.[^.]+$/, '');
export function regressionPlan(
  files: ChangedFile[],
  contracts: ContractChange[],
  repositoryPaths: string[] = [],
) {
  const testPaths = [
    ...new Set([...repositoryPaths, ...files.filter((f) => f.status !== 'removed').map((f) => f.path)]),
  ].filter(isTest);
  const candidates = files
    .filter((f) => !isTest(f.path) && /\.[cm]?[jt]sx?$/.test(f.path))
    .slice(0, 100)
    .map((file) => {
      const relatedTests = testPaths.filter((path) => {
        const sameStem =
          stem(path) === stem(file.path) && !['index', 'main', 'utils'].includes(stem(file.path));
        const changed = files.find((f) => f.path === path);
        const imports = [...(changed?.after ?? '').matchAll(/(?:from\s*|import\s*\()['"]([^'"]+)['"]/g)].map(
          (match) => match[1] ?? '',
        );
        const directImport = imports.some(
          (specifier) =>
            specifier.startsWith('.') &&
            posix.normalize(posix.join(posix.dirname(path), specifier)).replace(/\.[cm]?[jt]sx?$/, '') ===
              file.path.replace(/\.[cm]?[jt]sx?$/, ''),
        );
        return sameStem || directImport;
      });
      const changes = contracts.filter((c) => c.path === file.path);
      const cases = changes.map((change) => ({
        title: change.title,
        arrange: 'Use a consumer or fixture that worked against the base revision.',
        act: `Exercise ${change.symbol} with the previous arguments, imports or object shape.`,
        assert: change.migration,
        evidence: change.evidence,
      }));
      if (!cases.length) {
        const changedLines = (file.patch ?? '')
          .split('\n')
          .filter((line) => /^[+-](?![+-])/.test(line))
          .slice(0, 12)
          .join('\n');
        const evidence: Evidence[] = changedLines
          ? [{ path: file.path, side: 'after', line: 0, text: redact(changedLines).slice(0, 700) }]
          : [];
        cases.push({
          title: 'Characterize changed behavior',
          arrange: 'Start with a previously valid input and one boundary or error input.',
          act: `Run the same scenario against the base and head versions of ${file.path}.`,
          assert:
            'Confirm intended output/error behavior; turn any unintended difference into a regression test. Patch excerpt below has no precise source-line mapping.',
          evidence,
        });
      }
      const changedTests = relatedTests.filter((path) =>
        files.some((f) => f.path === path && f.status !== 'removed'),
      );
      return {
        path: file.path,
        relatedTests,
        changedTests,
        status: changedTests.length
          ? 'related-tests-changed'
          : relatedTests.length
            ? 'related-tests-unchanged'
            : 'no-related-test-found',
        cases,
      };
    });
  return {
    candidates,
    limitations: [
      'Test association uses filename stems and direct relative imports in available changed test content. This is not runtime coverage; changed tests do not prove a scenario is tested. Suggestions are reviewable test plans, not executed or generated passing tests.',
      ...(files.filter((f) => !isTest(f.path) && /\.[cm]?[jt]sx?$/.test(f.path)).length > 100
        ? ['Regression suggestions limited to the first 100 source files.']
        : []),
    ],
  };
}
