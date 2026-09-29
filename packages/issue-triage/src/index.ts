import type { Finding, Issue, SourceFile } from '@openmaintainer/core';
import { boundedText, hasPathMention, redact, safePath } from '@openmaintainer/shared';

const categories: [string, RegExp][] = [
  ['security', /vulnerab|security|credential leak|exploit/i],
  ['regression', /regression|used to work|worked before/i],
  ['performance', /slow|performance|memory leak|latency/i],
  ['bug', /bug|crash|error|broken|fails?\b/i],
  ['documentation', /documentation|readme|typo/i],
  ['feature', /feature|enhancement|add support/i],
  ['question', /how (do|can|to)|\?$/i],
  ['support', /help|install|setup/i],
];
export function analyzeIssue(
  issue: Issue,
  options: { labels?: Record<string, string>; staleDays?: number; now?: Date } = {},
) {
  const text = `${issue.title}\n${issue.body}`,
    category = categories.find(([, pattern]) => pattern.test(text))?.[0] ?? 'other',
    findings: Finding[] = [];
  if (['bug', 'regression', 'performance'].includes(category)) {
    if (!/reproduc|steps to|1\.|minimal example/i.test(issue.body))
      findings.push({
        ruleId: 'issue.reproduction',
        severity: 'warning',
        title: 'Reproduction details missing',
        explanation: 'Ask for a minimal reproduction or numbered steps.',
      });
    if (!/version|v?\d+\.\d+(\.\d+)?/i.test(issue.body))
      findings.push({
        ruleId: 'issue.version',
        severity: 'info',
        title: 'Version not specified',
        explanation: 'Ask which release and runtime version are affected.',
      });
    if (!/logs?|stack\s*trace|\x60\x60\x60/i.test(issue.body))
      findings.push({
        ruleId: 'issue.logs',
        severity: 'info',
        title: 'Logs not included',
        explanation: 'Ask for relevant logs with credentials removed.',
      });
  }
  const ageDays = ((options.now ?? new Date()).getTime() - Date.parse(issue.updatedAt)) / 86400000;
  if (issue.state === 'open' && ageDays > (options.staleDays ?? 90))
    findings.push({
      ruleId: 'issue.stale',
      severity: 'info',
      title: 'Issue has been inactive',
      explanation: `Last update was ${Math.floor(ageDays)} days ago; no automatic closure is recommended.`,
    });
  return {
    category,
    suggestedLabels: [options.labels?.[category] ?? category],
    findings,
    needsMaintainerResponse: issue.state === 'open',
    automaticClosure: false as const,
  };
}
const stop = new Set([
  'the',
  'and',
  'with',
  'this',
  'that',
  'from',
  'have',
  'when',
  'does',
  'for',
  'not',
  'are',
  'was',
  'can',
  'but',
  'you',
]);
export function keywords(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/https?:\/\/\S+/g, ' ')
      .split(/[^\p{L}\p{N}_]+/u)
      .filter((t) => t.length > 2 && !stop.has(t)),
  );
}
export interface DuplicateCandidate {
  number: number;
  score: number;
  explanation: string;
  sharedTerms: string[];
}
export function findDuplicates(target: Issue, others: Issue[], threshold = 0.35): DuplicateCandidate[] {
  const title = keywords(target.title),
    body = keywords(target.body);
  function similarity(a: Set<string>, b: Set<string>) {
    const intersection = [...a].filter((t) => b.has(t));
    return { score: intersection.length / Math.max(new Set([...a, ...b]).size, 1), intersection };
  }
  return others
    .filter((i) => i.number !== target.number)
    .map((issue) => {
      const t = similarity(title, keywords(issue.title)),
        b = similarity(body, keywords(issue.body)),
        labels = target.labels.length
          ? target.labels.filter((l) => issue.labels.includes(l)).length / target.labels.length
          : 0;
      const score = Math.round((t.score * 0.7 + b.score * 0.25 + labels * 0.05) * 1000) / 1000;
      return {
        number: issue.number,
        score,
        explanation:
          'Weighted lexical similarity (70% title, 25% body, 5% shared labels); not a calibrated probability.',
        sharedTerms: [...new Set([...t.intersection, ...b.intersection])].slice(0, 12),
      };
    })
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score || a.number - b.number)
    .slice(0, 10);
}

export function navigateIssue(text: string, files: SourceFile[]) {
  boundedText(text, 50000);
  const query = redact(text);
  const identifiers = new Set(query.split(/[^\w$]+/));
  const terms = keywords(query.replace(/([a-z])([A-Z])/g, '$1 $2'));
  const candidates = files
    .slice(0, 10000)
    .flatMap((file) => {
      safePath(file.path);
      const reasons: string[] = [];
      let score = 0;
      if (hasPathMention(query, file.path)) {
        reasons.push('The issue text contains this exact repository path.');
        score += 10;
      }
      const pathTerms = [...keywords(file.path.replace(/([a-z])([A-Z])/g, '$1 $2'))].filter(
        (term) =>
          ![
            'src',
            'lib',
            'test',
            'tests',
            'index',
            'main',
            'packages',
            'apps',
            'tsx',
            'jsx',
            'json',
          ].includes(term),
      );
      const sharedTerms = pathTerms.filter((term) => terms.has(term));
      if (sharedTerms.length) {
        score += sharedTerms.length;
        reasons.push(`Shared path terms: ${sharedTerms.join(', ')}.`);
      }
      const evidence: { line: number; text: string; symbol: string }[] = [];
      for (const [index, line] of file.content.split(/\r?\n/).entries()) {
        const match = /\b(?:function|class|interface|type|const|let)\s+([A-Za-z_$][\w$]{2,})/.exec(line);
        if (match?.[1] && identifiers.has(match[1])) {
          score += 5;
          evidence.push({ line: index + 1, text: redact(line).slice(0, 500), symbol: match[1] });
          reasons.push(`The issue names declaration ${match[1]} in available source.`);
        }
        if (evidence.length >= 3) break;
      }
      return score > 0
        ? [
            {
              path: file.path,
              score,
              reasons,
              evidence,
              nextStep:
                'Verify the reproduction against this file and follow its callers. Text matches are investigation leads, not a diagnosis.',
            },
          ]
        : [];
    })
    .sort((a, b) => b.score - a.score || a.path.localeCompare(b.path))
    .slice(0, 10);
  return {
    supplied: Boolean(text.trim()),
    candidates,
    scope:
      'Repository paths plus available source contents. Scores rank lexical evidence and are not probabilities. No semantic call graph or root-cause proof.',
  };
}
