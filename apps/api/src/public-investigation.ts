import type { ChangedFile } from '@openmaintainer/core';
import { investigateChanges } from '@openmaintainer/pr-analysis';
import { AppError, positiveId, repositoryName, safePath } from '@openmaintainer/shared';
import { z } from 'zod';

const sha = z.string().regex(/^[a-f0-9]{40}$/i);
const repository = z.object({ full_name: repositoryName, private: z.literal(false) });
const prSchema = z.object({
  title: z.string(),
  changed_files: z.number().int().min(0),
  base: z.object({ sha, repo: repository }),
  head: z.object({ sha, repo: repository.nullable() }),
});
const treeSchema = z.object({
  truncated: z.boolean(),
  tree: z.array(z.object({ path: z.string(), type: z.string(), mode: z.string() })),
});
export function parsePublicPullRequest(value: string) {
  const match =
    /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*)\/pull\/([1-9]\d*)\/?$/.exec(
      value.trim(),
    );
  if (!match)
    throw new AppError(
      'PR_URL',
      'Paste a public GitHub pull request URL: https://github.com/owner/repository/pull/123.',
    );
  return { name: repositoryName.parse(match[1]), number: positiveId.parse(match[2]) };
}

export async function investigatePublicPullRequest(
  input: { url: string; issue?: string; ciLog?: string },
  transport: typeof fetch = fetch,
) {
  const controller = new AbortController();
  try {
    return await collectPublicPullRequest(
      input,
      transport,
      AbortSignal.any([controller.signal, AbortSignal.timeout(18000)]),
    );
  } finally {
    controller.abort();
  }
}
async function collectPublicPullRequest(
  input: { url: string; issue?: string; ciLog?: string },
  transport: typeof fetch,
  signal: AbortSignal,
) {
  const { name, number } = parsePublicPullRequest(input.url);
  let requests = 0,
    bytes = 0;
  async function read(repo: string, suffix: string): Promise<unknown> {
    repositoryName.parse(repo);
    if (++requests > 24)
      throw new AppError('PR_LIMIT', 'Public investigation reached its request limit.', 422);
    try {
      const response = await transport(`https://api.github.com/repos/${repo}${suffix}`, {
        redirect: 'error',
        signal,
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'OpenMaintainer-investigation' },
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new AppError(
          response.status === 404 ? 'PR_NOT_FOUND' : 'PR_UPSTREAM',
          response.status === 404
            ? 'Public PR or source revision not found; private/deleted forks are not supported here.'
            : [403, 429].includes(response.status)
              ? 'GitHub anonymous rate limit reached. Try again later.'
              : 'GitHub could not provide this PR. Please try again.',
          [403, 429].includes(response.status) ? 429 : response.status === 404 ? 404 : 502,
        );
      }
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Missing response body');
      const chunks: Uint8Array[] = [];
      let responseBytes = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.length;
          responseBytes += chunk.value.length;
          if (responseBytes > 5_000_000 || bytes > 10_000_000)
            throw new AppError('PR_LIMIT', 'PR data exceeds the bounded inspection size.', 422);
          chunks.push(chunk.value);
        }
      } finally {
        await reader.cancel();
      }
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError(
        'PR_UNAVAILABLE',
        'The investigation timed out or GitHub returned invalid data. Try a smaller PR or retry later.',
        502,
      );
    }
  }
  const pr = prSchema.parse(await read(name, `/pulls/${number}`));
  if (pr.changed_files > 200)
    throw new AppError('PR_LIMIT', 'Public investigation supports at most 200 changed files.', 422);
  if (pr.base.repo.full_name.toLowerCase() !== name.toLowerCase() || !pr.head.repo)
    throw new AppError('PR_SOURCE', 'PR source repository is unavailable.', 422);
  const rowsSchema = z.array(
    z.object({
      filename: z.string(),
      previous_filename: z.string().optional(),
      status: z.string(),
      additions: z.number(),
      deletions: z.number(),
      patch: z.string().max(250000).optional(),
    }),
  );
  const rows = rowsSchema.parse(await read(name, `/pulls/${number}/files?per_page=100&page=1`));
  if (pr.changed_files > 100)
    rows.push(...rowsSchema.parse(await read(name, `/pulls/${number}/files?per_page=100&page=2`)));
  if (rows.length !== pr.changed_files)
    throw new AppError('PR_TRUNCATED', 'GitHub returned an incomplete changed-file list.', 422);
  const comparison = z
    .object({ merge_base_commit: z.object({ sha }) })
    .parse(await read(name, `/compare/${pr.base.sha}...${pr.head.sha}`));
  const mergeBase = comparison.merge_base_commit.sha;
  const [baseTree, headTree] = await Promise.all([
    read(name, `/git/trees/${mergeBase}?recursive=1`).then((value) => treeSchema.parse(value)),
    read(pr.head.repo.full_name, `/git/trees/${pr.head.sha}?recursive=1`).then((value) =>
      treeSchema.parse(value),
    ),
  ]);
  if ([baseTree, headTree].some((tree) => tree.truncated || tree.tree.length > 10000))
    throw new AppError(
      'PR_TREE_LIMIT',
      'Complete base/head trees are required; limit is 10,000 entries per tree.',
      422,
    );
  const basePaths = new Set(
    baseTree.tree
      .filter((entry) => entry.type === 'blob' && entry.mode !== '120000')
      .map((entry) => safePath(entry.path)),
  );
  const headPaths = new Set(
    headTree.tree
      .filter((entry) => entry.type === 'blob' && entry.mode !== '120000')
      .map((entry) => safePath(entry.path)),
  );
  const files: ChangedFile[] = rows.map((row) => ({
    path: safePath(row.filename),
    previousPath: row.previous_filename ? safePath(row.previous_filename) : undefined,
    status: ['added', 'removed', 'renamed'].includes(row.status)
      ? (row.status as ChangedFile['status'])
      : 'modified',
    additions: row.additions,
    deletions: row.deletions,
    patch: row.patch,
  }));
  const selected = files
    .filter((file) => /\.[cm]?[jt]sx?$|(^|\/)(package\.json|[^/]*config[^/]*\.json)$/.test(file.path))
    .slice(0, 8);
  const content = async (repo: string, path: string, ref: string): Promise<string | undefined> => {
    try {
      const result = z
        .object({
          type: z.string(),
          encoding: z.string().optional(),
          size: z.number().optional(),
          content: z.string().optional(),
        })
        .parse(await read(repo, `/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${ref}`));
      if (
        result.type !== 'file' ||
        result.encoding !== 'base64' ||
        result.size === undefined ||
        result.size > 125000 ||
        result.content === undefined
      )
        return undefined;
      const decoded = Buffer.from(result.content, 'base64');
      return decoded.length <= 125000 && !decoded.includes(0) ? decoded.toString('utf8') : undefined;
    } catch (error) {
      if (error instanceof AppError && error.status === 404) return undefined;
      throw error;
    }
  };
  // Four upstream requests at most in each batch; absent sides are known empty, not missing data.
  for (let offset = 0; offset < selected.length; offset += 2) {
    await Promise.all(
      selected.slice(offset, offset + 2).map(async (file) => {
        const beforePath = file.previousPath ?? file.path;
        const [before, after] = await Promise.all([
          file.status === 'added'
            ? Promise.resolve('')
            : basePaths.has(beforePath)
              ? content(name, beforePath, mergeBase)
              : Promise.resolve(undefined),
          file.status === 'removed'
            ? Promise.resolve('')
            : headPaths.has(file.path)
              ? content(pr.head.repo?.full_name ?? name, file.path, pr.head.sha)
              : Promise.resolve(undefined),
        ]);
        file.before = before;
        file.after = after;
      }),
    );
  }
  const latest = prSchema.parse(await read(name, `/pulls/${number}`));
  if (
    latest.head.sha !== pr.head.sha ||
    latest.base.sha !== pr.base.sha ||
    latest.changed_files !== pr.changed_files
  )
    throw new AppError('PR_CHANGED', 'This PR changed during analysis. Run the investigation again.', 409);
  const report = investigateChanges(files, {
    issue: input.issue,
    ciLog: input.ciLog,
    repositoryFiles: [...headPaths].map((path) => ({
      path,
      content: files.find((file) => file.path === path)?.after ?? '',
    })),
  });
  return {
    ...report,
    source: {
      repository: name,
      headRepository: pr.head.repo.full_name,
      number,
      title: pr.title,
      url: `https://github.com/${name}/pull/${number}`,
      base: mergeBase,
      head: pr.head.sha,
      checkedAt: new Date().toISOString(),
      requests,
    },
    limitations: [
      ...report.limitations,
      'Public mode inspects full versions of at most eight eligible JS/TS/config files, in GitHub file-list order; 125 KB per version. Other files are listed as uninspected. Anonymous GitHub quotas apply. No report is saved.',
    ],
  };
}
