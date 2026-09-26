import { AppError, boundedText } from '@openmaintainer/shared';
import semver from 'semver';
import { parseDocument } from 'yaml';
import { z } from 'zod';
export type Bump = 'patch' | 'minor' | 'major';
export interface Commit {
  sha: string;
  message: string;
}
export interface Change {
  bump: Bump;
  description: string;
  sha?: string;
}
const weight: Record<Bump, number> = { patch: 1, minor: 2, major: 3 };
export function conventionalChange(commit: Commit): Change | null {
  const match = /^(\w+)(?:\([^)]+\))?(!)?:\s+(.+)/.exec(commit.message);
  if (!match) return null;
  const breaking = Boolean(match[2]) || /^BREAKING[ -]CHANGE:/m.test(commit.message);
  const bump = breaking
    ? 'major'
    : match[1] === 'feat'
      ? 'minor'
      : ['fix', 'perf', 'revert'].includes(match[1] ?? '')
        ? 'patch'
        : null;
  return bump ? { bump, description: match[3] ?? commit.message, sha: commit.sha } : null;
}
export function parseChangeset(content: string): { packages: Record<string, Bump>; description: string } {
  boundedText(content, 100000);
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(content);
  if (!match) throw new AppError('CHANGESET_FORMAT', 'Changeset requires YAML frontmatter');
  const doc = parseDocument(match[1] ?? '', { uniqueKeys: true });
  if (doc.errors.length || doc.warnings.length)
    throw new AppError('CHANGESET_YAML', 'Invalid or unsupported changeset YAML');
  return {
    packages: z.record(z.string(), z.enum(['patch', 'minor', 'major'])).parse(doc.toJS({ maxAliasCount: 0 })),
    description: (match[2] ?? '').trim(),
  };
}
export function prepareRelease(
  currentVersion: string,
  commits: Commit[],
  changes: Change[] = [],
  candidate?: number,
) {
  if (!semver.valid(currentVersion))
    throw new AppError('RELEASE_VERSION', 'Invalid current semantic version');
  const all = [
    ...commits.flatMap((c) => {
      const x = conventionalChange(c);
      return x ? [x] : [];
    }),
    ...changes,
  ];
  const bump = all.reduce<Bump | null>(
    (acc, c) => (!acc || weight[c.bump] > weight[acc] ? c.bump : acc),
    null,
  );
  const next = bump ? semver.inc(currentVersion, bump) : currentVersion;
  if (!next) throw new AppError('RELEASE_VERSION', 'Cannot calculate next version');
  if (candidate !== undefined && (!Number.isInteger(candidate) || candidate < 1 || candidate > 9999))
    throw new AppError('RELEASE_CANDIDATE', 'Candidate must be 1–9999');
  const version = candidate === undefined ? next : `${next}-rc.${candidate}`;
  const notes = [
    `# ${version}`,
    '',
    ...(['major', 'minor', 'patch'] as const).flatMap((kind) => {
      const entries = all.filter((c) => c.bump === kind);
      return entries.length
        ? [
            `## ${{ major: 'Breaking changes', minor: 'Features', patch: 'Fixes' }[kind]}`,
            '',
            ...entries.map((c) => `- ${c.description}${c.sha ? ` (${c.sha.slice(0, 7)})` : ''}`),
            '',
          ]
        : [];
    }),
  ].join('\n');
  return {
    currentVersion,
    version,
    bump,
    changes: all,
    notes,
    prerelease: candidate !== undefined,
    ready: bump !== null,
    published: false as const,
  };
}
export function validateRelease(version: string, notes: string, existingTags: string[]): string[] {
  const errors: string[] = [];
  if (!semver.valid(version)) errors.push('Invalid semantic version');
  if (existingTags.some((t) => t === version || t === `v${version}`)) errors.push('Version already exists');
  if (!notes.trim()) errors.push('Release notes are empty');
  return errors;
}
