import { investigateCi } from '@openmaintainer/ci-analysis';
import type { ChangedFile, SourceFile } from '@openmaintainer/core';
import { navigateIssue } from '@openmaintainer/issue-triage';
import { AppError, boundedText, safePath } from '@openmaintainer/shared';
import { contractChanges } from './contracts.js';
import { regressionPlan } from './regression.js';

export function investigateChanges(
  files: ChangedFile[],
  options: { issue?: string; ciLog?: string; repositoryFiles?: SourceFile[] } = {},
) {
  if (files.length > 200)
    throw new AppError('INVESTIGATION_LIMIT', 'Investigation supports up to 200 changed files.', 422);
  let bytes = 0;
  for (const file of files) {
    safePath(file.path);
    for (const value of [file.before, file.after, file.patch])
      if (value !== undefined) {
        boundedText(value, 250000);
        bytes += Buffer.byteLength(value);
      }
  }
  if (bytes > 5_000_000) throw new AppError('INVESTIGATION_LIMIT', 'Investigation source exceeds 5 MB.', 422);
  const contracts = contractChanges(files);
  const repositoryFiles =
    options.repositoryFiles ??
    files.filter((f) => f.status !== 'removed').map((f) => ({ path: f.path, content: f.after ?? '' }));
  const regression = regressionPlan(
    files,
    contracts.changes,
    repositoryFiles.map((file) => file.path),
  );
  const ci = investigateCi(options.ciLog ?? '', files);
  const issue = navigateIssue(options.issue ?? '', repositoryFiles);
  const uninspected = files
    .filter((file) => file.before === undefined || file.after === undefined)
    .map((file) => file.path);
  const migrations = contracts.changes.map((change) => ({
    id: change.id,
    path: change.path,
    title: change.title,
    action: change.migration,
    evidence: change.evidence,
  }));
  const checks = [
    ...migrations.map((migration) => ({
      path: migration.path,
      task: migration.action,
      basis: migration.title,
    })),
    ...regression.candidates
      .filter((candidate) => !candidate.changedTests.length)
      .map((candidate) => ({
        path: candidate.path,
        task: 'Review the proposed regression scenarios and add or identify tests for intended behavior.',
        basis: candidate.status,
      })),
    ...files
      .filter((file) => /migration|schema/i.test(file.path))
      .map((file) => ({
        path: file.path,
        task: 'Review forward/backward database compatibility and validate migration and recovery on disposable data.',
        basis: 'Database-related filename changed; destructive behavior has not been proven.',
      })),
    ...files
      .filter((file) => /(^|\/)(package\.json|.*lock.*)$/.test(file.path))
      .map((file) => ({
        path: file.path,
        task: 'Verify dependency/runtime compatibility using the changed manifest and lockfile.',
        basis: 'Dependency metadata changed.',
      })),
  ];
  const release = {
    recommendation: contracts.changes.length
      ? 'Compatibility review required before selecting a release version.'
      : uninspected.length
        ? 'Incomplete inspection: do not infer release safety from the absence of findings.'
        : 'No supported contract changes detected; behavior and consumer compatibility still need review.',
    scope:
      'Release risks from this change set only, not every change since the last tag. No version bump or release is approved automatically.',
    migrations,
    checklist: checks,
    ciStatus: ci.supplied
      ? 'Supplied log analyzed; live CI status is unknown.'
      : 'No CI evidence supplied; live CI status is unknown.',
  };
  return {
    version: 1,
    contracts,
    regression,
    ci,
    release,
    issue,
    coverage: {
      changedFiles: files.length,
      completeVersions: files.length - uninspected.length,
      uninspected,
      repositoryPaths: repositoryFiles.length,
    },
    limitations: [
      'No repository code or tests were executed. Findings are evidence-backed review prompts, not approval to merge or publish.',
      ...(uninspected.length
        ? ['Some full file versions are unavailable; contract comparisons skip those files.']
        : []),
    ],
  };
}
