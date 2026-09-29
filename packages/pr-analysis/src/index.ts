import type { ChangedFile, Finding } from '@openmaintainer/core';
import { safePath } from '@openmaintainer/shared';
import { breakingChanges } from './breaking.js';

export { breakingChanges } from './breaking.js';
export { investigateChanges } from './investigation.js';
export function analyzePullRequest(
  files: ChangedFile[],
  options: { body?: string; firstTimeContributor?: boolean; workspaceRoots?: string[] } = {},
) {
  for (const f of files) safePath(f.path);
  const paths = files.map((f) => f.path),
    testFiles = paths.filter((p) => /(^|\/)(__tests__|tests?)\/|\.(test|spec)\.[^.]+$/.test(p));
  const source = paths.filter(
    (p) => /\.[cm]?[jt]sx?$|\.py$|\.go$|\.rs$|\.luau?$/.test(p) && !testFiles.includes(p),
  );
  const findings: Finding[] = breakingChanges(files),
    additions = files.reduce((s, f) => s + f.additions, 0),
    deletions = files.reduce((s, f) => s + f.deletions, 0);
  if (source.length && !testFiles.length)
    findings.push({
      ruleId: 'pr.missing-tests',
      severity: 'warning',
      title: 'Source changed without test-file changes',
      explanation: 'This is a change indicator, not a measurement of test coverage.',
    });
  if (files.length > 50 || additions + deletions > 1000)
    findings.push({
      ruleId: 'pr.large',
      severity: 'warning',
      title: 'Large review scope',
      explanation: `${files.length} files and ${additions + deletions} changed lines.`,
    });
  const security = paths.filter((p) =>
    /(^|\/)(auth|security|permissions|crypto|secrets)(\/|\.)|\.github\/workflows\/|Dockerfile/.test(p),
  );
  for (const path of security)
    findings.push({
      ruleId: 'pr.security-sensitive',
      severity: 'warning',
      title: 'Security-sensitive file changed',
      explanation: 'Review access boundaries, workflow permissions and input handling.',
      path,
    });
  if (options.body !== undefined && !/(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#\d+/i.test(options.body))
    findings.push({
      ruleId: 'contributor.linked-issue',
      severity: 'info',
      title: 'No linked issue detected',
      explanation: 'Link a related issue when one exists.',
    });
  if (options.firstTimeContributor)
    findings.push({
      ruleId: 'contributor.first-time',
      severity: 'info',
      title: 'First contribution',
      explanation: 'Provide repository setup and review guidance.',
    });
  const affectedComponents = [
    ...new Set(
      paths.map(
        (p) =>
          (options.workspaceRoots ?? [])
            .filter((r) => p.startsWith(`${r}/`))
            .sort((a, b) => b.length - a.length)[0] ??
          (p.includes('/') ? (p.split('/')[0] ?? 'root') : 'root'),
      ),
    ),
  ];
  return {
    summary: {
      files: files.length,
      additions,
      deletions,
      testsChanged: testFiles.length,
      sourceFiles: source.length,
    },
    affectedComponents,
    findings,
    risk: findings.some((f) => f.ruleId.startsWith('breaking.'))
      ? 'high'
      : findings.some((f) => f.severity === 'warning')
        ? 'medium'
        : 'low',
    indicators: {
      dependenciesChanged: paths.some((p) => /package.json|lock|requirements|pyproject|Cargo.toml/.test(p)),
      ciChanged: paths.some((p) => p.startsWith('.github/workflows/')),
      databaseChanged: paths.some((p) => /migration|schema/i.test(p)),
      docsChanged: paths.some((p) => /\.md$|^docs\//.test(p)),
      publicApiChanged: findings.some((f) => f.ruleId.startsWith('breaking.')),
    },
    reviewChecklist: [...new Set(findings.map((f) => f.explanation))],
    limitations: files.some((f) => f.before === undefined || f.after === undefined)
      ? ['Some complete file versions are unavailable; export and signature comparisons may be incomplete.']
      : [],
  };
}
