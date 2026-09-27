import { analyzeRepository } from '@openmaintainer/repository-analysis';
import { AppError, repositoryName } from '@openmaintainer/shared';
import { z } from 'zod';

export function parsePublicRepository(input: string): string {
  const value = input.trim();
  const match =
    /^(?:https:\/\/github\.com\/)?([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)\/?$/.exec(value);
  if (!match?.[1])
    throw new AppError(
      'REPOSITORY_URL',
      'Enter owner/repository or an https://github.com/owner/repository URL.',
    );
  return repositoryName.parse(match[1].replace(/\.git$/, ''));
}

/** Anonymous, read-only requests. Never forward user or installation credentials. */
export async function scanPublicRepository(input: string, transport: typeof fetch = fetch) {
  const name = parsePublicRepository(input);
  const signal = AbortSignal.timeout(18000);
  async function read(path: string): Promise<unknown> {
    try {
      const response = await transport(`https://api.github.com/repos/${name}${path}`, {
        redirect: 'error',
        signal,
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenMaintainer-public-checker' },
      });
      if (!response.ok) {
        await response.body?.cancel();
        if (response.status === 404)
          throw new AppError(
            'PUBLIC_REPOSITORY',
            'Public repository not found. Check the URL; private repositories require the GitHub App.',
            404,
          );
        if ([403, 429].includes(response.status))
          throw new AppError(
            'GITHUB_LIMIT',
            'GitHub is limiting anonymous requests. Please try again later.',
            429,
          );
        if (response.status === 409)
          throw new AppError(
            'EMPTY_REPOSITORY',
            'This repository has no default-branch files to check.',
            422,
          );
        throw new AppError(
          'GITHUB_UNAVAILABLE',
          'GitHub could not provide the repository. Please try again later.',
          502,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing response');
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        while (true) {
          const part = await reader.read();
          if (part.done) break;
          size += part.value.length;
          if (size > 5_000_000)
            throw new AppError('SCAN_LIMIT', 'Repository data exceeds the 5 MB checker limit.', 422);
          chunks.push(part.value);
        }
      } finally {
        await reader.cancel();
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'GITHUB_UNAVAILABLE',
        'GitHub could not be reached or returned invalid data. Please try again.',
        502,
      );
    }
  }
  const metadata = z
    .object({ private: z.literal(false), default_branch: z.string().min(1), archived: z.boolean() })
    .parse(await read(''));
  const tree = z
    .object({
      sha: z.string(),
      truncated: z.boolean(),
      tree: z.array(z.object({ path: z.string(), type: z.string(), mode: z.string() })),
    })
    .parse(await read(`/git/trees/${encodeURIComponent(metadata.default_branch)}?recursive=1`));
  if (tree.truncated || tree.tree.length > 10000)
    throw new AppError(
      'SCAN_LIMIT',
      'Repository exceeds the complete-tree limit of 10,000 entries. No partial report was generated.',
      422,
    );
  const files = tree.tree.filter((entry) => entry.type === 'blob' && entry.mode !== '120000');
  const profile = analyzeRepository(files.map((entry) => ({ path: entry.path, content: '' })));
  return {
    repository: name,
    url: `https://github.com/${name}`,
    branch: metadata.default_branch,
    treeSha: tree.sha,
    checkedAt: new Date().toISOString(),
    archived: metadata.archived,
    fileCount: files.length,
    languages: Object.keys(profile.languages),
    findings: profile.findings,
    checks: ['readme', 'license', 'contributing', 'security', 'codeowners', 'ci'].map((id) => ({
      id,
      present: !profile.findings.some((finding) => finding.ruleId === `repository.missing-${id}`),
    })),
    scope:
      'File-tree maintenance check only. File presence does not verify content quality. No code execution, vulnerability audit, dependency version check, or live CI-result analysis. Symlinks and submodule contents are not inspected. Results are not saved or synchronized.',
  };
}
