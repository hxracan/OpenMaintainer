import { stripVTControlCharacters } from 'node:util';
import type { ChangedFile } from '@openmaintainer/core';
import { boundedText, hasPathMention, redact } from '@openmaintainer/shared';

const patterns: [string, RegExp, string][] = [
  [
    'out-of-memory',
    /heap out of memory|oomkilled|out of memory|exit code 137/i,
    'Inspect peak memory and worker concurrency. Exit 137 can also indicate an external kill.',
  ],
  [
    'timeout',
    /timed? ?out|timeout exceeded|exceeded.*time limit/i,
    'Check the slow step, network retries and job timeout.',
  ],
  [
    'missing-secret',
    /secret.*(not found|missing|undefined)|missing.*(?:token|api.key)|authentication required/i,
    'Verify the secret name and whether this event can access secrets.',
  ],
  [
    'dependency-install',
    /ERESOLVE|ERR_PNPM|npm ERR!|resolution failed|could not find a version/i,
    'Check lockfile consistency, runtime versions and registry availability.',
  ],
  ['type-error', /error TS\d+|mypy.*error|incompatible types/i, 'Inspect the reported type and its callers.'],
  [
    'lint',
    /eslint|biome.*error|ruff.*error|lint.*fail/i,
    'Run the same pinned linter locally and inspect the first diagnostic.',
  ],
  [
    'test',
    /FAIL\s|AssertionError|assertion failed|Tests?\s+\d+ failed|FAILED .+::/i,
    'Reproduce the failing test using the same runtime and fixtures.',
  ],
  [
    'docker',
    /failed to solve|docker.*error|failed to compute cache key/i,
    'Inspect the build stage, context and base image availability.',
  ],
  [
    'build',
    /build failed|compilation failed|Module not found|Cannot find module/i,
    'Inspect the first build error and package resolution configuration.',
  ],
];
export function analyzeCi(log: string) {
  boundedText(log, 2_000_000);
  const lines = stripVTControlCharacters(redact(log)).split(/\r?\n/);
  const groups = new Map<
    string,
    { category: string; diagnosis: string; occurrences: number; excerpts: { line: number; text: string }[] }
  >();
  for (const [i, line] of lines.entries())
    for (const [category, pattern, diagnosis] of patterns)
      if (pattern.test(line)) {
        const group = groups.get(category) ?? { category, diagnosis, occurrences: 0, excerpts: [] };
        group.occurrences++;
        if (group.excerpts.length < 5)
          group.excerpts.push({
            line: i + 1,
            text: lines
              .slice(Math.max(0, i - 1), i + 3)
              .join('\n')
              .slice(0, 1800),
          });
        groups.set(category, group);
        break;
      }
  return {
    groups: [...groups.values()],
    lineCount: lines.length,
    diagnosed: groups.size > 0,
    limitations: groups.size
      ? ['Pattern-based suggestions require verification against the failing step.']
      : ['No known diagnostic pattern matched; inspect the original job log.'],
  };
}

export function investigateCi(log: string, files: ChangedFile[]) {
  const analysis = analyzeCi(log);
  const lines = stripVTControlCharacters(redact(log)).split(/\r?\n/);
  const correlations: { path: string; logLine: number; excerpt: string; basis: string; nextStep: string }[] =
    [];
  for (const file of files) {
    const paths = [file.path, ...(file.previousPath ? [file.previousPath] : [])];
    for (const [index, line] of lines.entries()) {
      if (paths.some((path) => hasPathMention(line, path))) {
        correlations.push({
          path: file.path,
          logLine: index + 1,
          excerpt: line.slice(0, 1000),
          basis:
            'A changed repository path appears in the supplied log; this is correlation, not proof of causation.',
          nextStep:
            'Inspect this diagnostic and the diff together. Reproduce the failing step at the recorded head, then compare against the base.',
        });
        break;
      }
    }
    if (correlations.length >= 20) break;
  }
  return {
    ...analysis,
    supplied: Boolean(log.trim()),
    correlations,
    provenance: 'User-supplied log; association with this PR and run is not verified.',
    limitations: [
      ...analysis.limitations,
      'Only exact path text is correlated. A missing match does not exclude a relationship. No workflow was rerun.',
    ],
  };
}
