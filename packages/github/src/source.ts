import type { ChangedFile, Issue, SourceFile } from '@openmaintainer/core';
import { AppError, asRecord, numeric, safePath, textField } from '@openmaintainer/shared';
import type { GitHubClient } from './index.js';
export async function fetchContent(
  gh: GitHubClient,
  repo: string,
  path: string,
  ref: string,
): Promise<string | undefined> {
  safePath(path);
  try {
    const file = await gh.request<{ type: string; size: number; encoding: string; content: string }>(
      `${gh.repoPath(repo)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
    );
    if (file.type !== 'file' || file.size > 250000 || file.encoding !== 'base64') return undefined;
    return Buffer.from(file.content, 'base64').toString('utf8');
  } catch (error) {
    if (error instanceof AppError && error.status === 404) return undefined;
    throw error;
  }
}
export async function repositorySource(
  gh: GitHubClient,
  repo: string,
  branch: string,
): Promise<{ sha: string; files: SourceFile[] }> {
  const commit = await gh.request<{ sha: string }>(
    `${gh.repoPath(repo)}/commits/${encodeURIComponent(branch)}`,
  );
  const tree = await gh.request<{ truncated: boolean; tree: { path: string; type: string; mode: string }[] }>(
    `${gh.repoPath(repo)}/git/trees/${commit.sha}?recursive=1`,
  );
  if (tree.truncated || tree.tree.length > 10000)
    throw new AppError('TREE_LIMIT', 'Repository tree exceeds 10000 entries; scan a smaller project');
  const entries = tree.tree.filter((f) => f.type === 'blob' && f.mode !== '120000');
  const files: SourceFile[] = [];
  let fetched = 0;
  for (const entry of entries) {
    safePath(entry.path);
    let content = '';
    if (
      /(^|\/)(package.json|pyproject.toml|pnpm-workspace.yaml|Cargo.toml|\.openmaintainer.yml)$/.test(
        entry.path,
      ) &&
      fetched < 100
    ) {
      content = (await fetchContent(gh, repo, entry.path, commit.sha)) ?? '';
      fetched++;
    }
    files.push({ path: entry.path, content });
  }
  return { sha: commit.sha, files };
}
export async function pullRequestSource(gh: GitHubClient, repo: string, number: number) {
  const path = `${gh.repoPath(repo)}/pulls/${number}`,
    pr = await gh.request<Record<string, unknown>>(path);
  const raw = await gh.paginate<Record<string, unknown>>(`${path}/files`);
  if (numeric(pr.changed_files) !== raw.length)
    throw new AppError('PR_TRUNCATED', 'GitHub did not return all changed files');
  if (raw.length > 500) throw new AppError('PR_LIMIT', 'PR exceeds the 500-file analysis limit');
  const base = textField(asRecord(pr.base).sha),
    head = textField(asRecord(pr.head).sha),
    files: ChangedFile[] = [];
  let fullVersions = 0;
  for (const row of raw) {
    const name = safePath(textField(row.filename)),
      status = ['added', 'removed', 'renamed'].includes(textField(row.status))
        ? (textField(row.status) as ChangedFile['status'])
        : 'modified';
    const file: ChangedFile = {
      path: name,
      status,
      additions: numeric(row.additions),
      deletions: numeric(row.deletions),
      patch: typeof row.patch === 'string' ? row.patch : undefined,
      previousPath: typeof row.previous_filename === 'string' ? row.previous_filename : undefined,
    };
    if (fullVersions < 80 && /\.[cm]?[jt]sx?$|package.json$|config.*\.json$|\.sql$/.test(name)) {
      file.before = status === 'added' ? '' : await fetchContent(gh, repo, file.previousPath ?? name, base);
      file.after = status === 'removed' ? '' : await fetchContent(gh, repo, name, head);
      fullVersions++;
    }
    files.push(file);
  }
  return { pr, files, head };
}
export function issueFromGitHub(value: Record<string, unknown>): Issue {
  return {
    number: numeric(value.number),
    title: textField(value.title),
    body: textField(value.body),
    author: textField(asRecord(value.user).login),
    labels: Array.isArray(value.labels) ? value.labels.map((l) => textField(asRecord(l).name)) : [],
    createdAt: textField(value.created_at),
    updatedAt: textField(value.updated_at),
    state: value.state === 'closed' ? 'closed' : 'open',
  };
}
