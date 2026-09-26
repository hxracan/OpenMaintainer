import { basename, dirname, extname } from 'node:path';

export { readRepository } from './local.js';

import type { Finding, RepositoryHealth, RepositoryProfile, SourceFile } from '@openmaintainer/core';
import { asRecord, digest, safePath } from '@openmaintainer/shared';

const languages: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript',
  '.py': 'Python',
  '.rs': 'Rust',
  '.go': 'Go',
  '.java': 'Java',
  '.lua': 'Lua',
  '.luau': 'Luau',
  '.cs': 'C#',
  '.rb': 'Ruby',
  '.php': 'PHP',
};
const managers: Record<string, string> = {
  'pnpm-lock.yaml': 'pnpm',
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
  'bun.lock': 'bun',
  'poetry.lock': 'poetry',
  'uv.lock': 'uv',
  'Cargo.lock': 'cargo',
  'go.sum': 'go',
};
const required: [string, RegExp, string][] = [
  ['readme', /(^|\/)readme\.(md|rst|txt)$/i, 'Explain installation and usage'],
  ['license', /(^|\/)licen[sc]e(\..*)?$/i, 'Declare reuse terms'],
  ['contributing', /(^|\/)contributing\.md$/i, 'Document contribution steps'],
  ['security', /(^|\/)security\.md$/i, 'Provide private vulnerability reporting instructions'],
  ['codeowners', /(^|\/)CODEOWNERS$/, 'Define reviewer ownership'],
  ['ci', /^\.github\/workflows\/[^/]+\.ya?ml$/, 'Add continuous integration'],
];
export function analyzeRepository(files: SourceFile[]): RepositoryProfile {
  if (files.length > 10000) throw new Error('Repository exceeds 10000-file analysis limit');
  const profile: RepositoryProfile = {
    languages: {},
    packageManagers: [],
    frameworks: [],
    workspaces: [],
    buildSystems: [],
    testFrameworks: [],
    manifests: [],
    publicApis: [],
    files: [],
    findings: [],
    fingerprint: '',
  };
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    safePath(file.path);
    profile.files.push(file.path);
    const name = basename(file.path),
      lang = languages[extname(name)];
    if (lang) profile.languages[lang] = (profile.languages[lang] ?? 0) + 1;
    if (managers[name]) profile.packageManagers.push(managers[name]);
    if (/^(package.json|pyproject.toml|requirements.*\.txt|Cargo.toml|go.mod|pom.xml|.*\.csproj)$/.test(name))
      profile.manifests.push(file.path);
    if (name === 'package.json' && file.content) {
      try {
        const pkg = asRecord(JSON.parse(file.content)),
          deps = { ...asRecord(pkg.dependencies), ...asRecord(pkg.devDependencies) };
        for (const fw of ['react', 'next', 'vue', 'svelte', 'express', 'fastify', 'nestjs', 'astro'])
          if (Object.keys(deps).some((d) => d === fw || d === `@${fw}/core`)) profile.frameworks.push(fw);
        for (const t of ['vitest', 'jest', 'mocha', '@playwright/test', 'cypress'])
          if (deps[t]) profile.testFrameworks.push(t);
        for (const t of ['turbo', 'nx', 'vite', 'webpack', 'rollup', 'tsup'])
          if (deps[t]) profile.buildSystems.push(t);
        const workspaces = Array.isArray(pkg.workspaces) ? pkg.workspaces : asRecord(pkg.workspaces).packages;
        if (Array.isArray(workspaces))
          profile.workspaces.push(...workspaces.filter((x): x is string => typeof x === 'string'));
        if (pkg.exports || pkg.main || pkg.types) profile.publicApis.push(file.path);
      } catch {
        profile.findings.push({
          ruleId: 'manifest.invalid-json',
          severity: 'error',
          title: 'Invalid package manifest',
          explanation: 'package.json could not be parsed as JSON.',
          path: file.path,
        });
      }
    }
    if (name === 'pnpm-workspace.yaml')
      profile.workspaces.push(dirname(file.path) === '.' ? 'pnpm workspace root' : dirname(file.path));
    if (/(^|\/)test[^/]*\.(py)$/.test(file.path) || name === 'pytest.ini')
      profile.testFrameworks.push('pytest');
    if (name === 'Makefile') profile.buildSystems.push('make');
  }
  for (const [id, pattern, reason] of required)
    if (!files.some((f) => pattern.test(f.path)))
      profile.findings.push({
        ruleId: `repository.missing-${id}`,
        severity: 'warning',
        title: `Missing ${id}`,
        explanation: `${reason}. No matching file was found in the analyzed tree.`,
      });
  if (files.some((f) => basename(f.path) === 'Dockerfile')) profile.buildSystems.push('docker');
  if (files.some((f) => f.path.startsWith('.changeset/'))) profile.buildSystems.push('changesets');
  for (const key of [
    'packageManagers',
    'frameworks',
    'workspaces',
    'buildSystems',
    'testFrameworks',
    'manifests',
    'publicApis',
  ] as const)
    profile[key] = [...new Set(profile[key])].sort();
  profile.fingerprint = digest(JSON.stringify(files.map((f) => [f.path, digest(f.content)]).sort()));
  return profile;
}
export interface HealthInput {
  remoteDataAvailable?: boolean;
  now?: Date;
  profile: RepositoryProfile;
  openPullRequests: { createdAt: string; reviewed: boolean }[];
  openIssues: { createdAt: string; firstResponseAt?: string }[];
  defaultBranchCi: 'success' | 'failure' | 'unknown';
  lastReleaseAt?: string;
  outdatedDependencies?: number;
}
export function repositoryHealth(input: HealthInput): RepositoryHealth {
  const now = input.now ?? new Date(),
    days = (date: string) => (now.getTime() - Date.parse(date)) / 86400000;
  const oldPrs = input.openPullRequests.filter((p) => days(p.createdAt) > 14);
  const unanswered = input.openIssues.filter((i) => !i.firstResponseAt && days(i.createdAt) > 7);
  const findings: Finding[] = [...input.profile.findings];
  if (oldPrs.length)
    findings.push({
      ruleId: 'health.pr-age',
      severity: 'warning',
      title: `${oldPrs.length} PRs older than 14 days`,
      explanation: 'Age is measured from creation, not a popularity score.',
    });
  if (unanswered.length)
    findings.push({
      ruleId: 'health.issue-response',
      severity: 'warning',
      title: `${unanswered.length} issues awaiting response`,
      explanation:
        'No recorded maintainer response after seven days. Missing response data must be verified.',
    });
  if (input.defaultBranchCi === 'failure')
    findings.push({
      ruleId: 'health.ci',
      severity: 'error',
      title: 'Default-branch CI is failing',
      explanation: 'Latest recorded default-branch workflow concluded with failure.',
    });
  const releaseDays = input.lastReleaseAt ? Math.floor(days(input.lastReleaseAt)) : null;
  if (releaseDays !== null && releaseDays > 180)
    findings.push({
      ruleId: 'health.release-age',
      severity: 'info',
      title: 'Last release over 180 days ago',
      explanation:
        'Review whether unreleased changes need publication; stable projects may not need frequent releases.',
    });
  return {
    findings,
    measuredAt: now.toISOString(),
    signals: {
      oldPullRequests: input.remoteDataAvailable === false ? null : oldPrs.length,
      unansweredIssues: input.remoteDataAvailable === false ? null : unanswered.length,
      unreviewedPrs:
        input.remoteDataAvailable === false ? null : input.openPullRequests.filter((p) => !p.reviewed).length,
      defaultBranchFailing: input.defaultBranchCi === 'unknown' ? null : input.defaultBranchCi === 'failure',
      daysSinceRelease: releaseDays,
      outdatedDependencies: input.outdatedDependencies ?? null,
    },
  };
}
