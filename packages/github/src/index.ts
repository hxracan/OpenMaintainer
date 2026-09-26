import { createSign } from 'node:crypto';

export { fetchContent, issueFromGitHub, pullRequestSource, repositorySource } from './source.js';

import { AppError, repositoryName, sleep } from '@openmaintainer/shared';
export class GitHubError extends AppError {
  constructor(
    status: number,
    public readonly retryAfter = 0,
  ) {
    super(`GITHUB_${status}`, `GitHub request failed (${status})`, status === 404 ? 404 : 502);
  }
}
export interface GitHubOptions {
  token: () => Promise<string>;
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}
export class GitHubClient {
  private cache = new Map<string, { etag: string; data: unknown }>();
  constructor(private options: GitHubOptions) {}
  async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    if (!path.startsWith('/') || path.startsWith('//') || path.includes('..') || /[\r\n\\]/.test(path))
      throw new AppError('GITHUB_PATH', 'Invalid GitHub API path');
    const url = new URL(path, 'https://api.github.com');
    if (url.origin !== 'https://api.github.com')
      throw new AppError('GITHUB_ORIGIN', 'Invalid GitHub API origin');
    const cached = method === 'GET' ? this.cache.get(path) : undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const response = await (this.options.fetch ?? fetch)(url, {
        method,
        redirect: 'error',
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${await this.options.token()}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
          ...(cached ? { 'If-None-Match': cached.etag } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (response.status === 304 && cached) return cached.data as T;
      const retryAfter = Math.max(
        Number(response.headers.get('retry-after') ?? 0),
        Number(response.headers.get('x-ratelimit-remaining')) === 0
          ? Number(response.headers.get('x-ratelimit-reset') ?? 0) - Date.now() / 1000
          : 0,
      );
      if (!response.ok) {
        if (
          method === 'GET' &&
          attempt < 2 &&
          (response.status === 429 || response.status >= 500) &&
          retryAfter <= 5
        ) {
          await (this.options.sleep ?? sleep)(Math.max(retryAfter * 1000, 250 * 2 ** attempt));
          continue;
        }
        throw new GitHubError(response.status, retryAfter);
      }
      if (response.status === 204) return undefined as T;
      const raw = await response.text();
      if (Buffer.byteLength(raw) > 10_000_000)
        throw new AppError('GITHUB_RESPONSE_SIZE', 'GitHub response too large');
      const data = JSON.parse(raw) as T;
      const etag = response.headers.get('etag');
      if (method === 'GET' && etag) {
        if (this.cache.size >= 500) this.cache.clear();
        this.cache.set(path, { etag, data });
      }
      return data;
    }
    throw new AppError('GITHUB_RETRIES', 'GitHub retry limit', 502);
  }
  async paginate<T>(path: string, maxPages = 50): Promise<T[]> {
    const all: T[] = [];
    for (let page = 1; page <= maxPages; page++) {
      const rows = await this.request<T[]>(
        `${path + (path.includes('?') ? '&' : '?')}per_page=100&page=${page}`,
      );
      if (!Array.isArray(rows)) throw new AppError('GITHUB_SHAPE', 'Expected list');
      all.push(...rows);
      if (rows.length < 100) return all;
    }
    throw new AppError(
      'GITHUB_PAGINATION',
      'Repository exceeds supported pagination limit; results are not silently truncated',
    );
  }
  repoPath(name: string): string {
    return `/repos/${repositoryName.parse(name)}`;
  }
  async jobLog(repository: string, jobId: number): Promise<string> {
    if (!Number.isSafeInteger(jobId) || jobId < 1) throw new AppError('JOB_ID', 'Invalid workflow job ID');
    const response = await (this.options.fetch ?? fetch)(
      `https://api.github.com${this.repoPath(repository)}/actions/jobs/${jobId}/logs`,
      {
        redirect: 'manual',
        signal: AbortSignal.timeout(20000),
        headers: {
          Authorization: `Bearer ${await this.options.token()}`,
          Accept: 'application/vnd.github+json',
        },
      },
    );
    if (response.status !== 302) throw new GitHubError(response.status);
    const location = new URL(response.headers.get('location') ?? 'invalid:');
    if (
      location.protocol !== 'https:' ||
      location.username ||
      location.password ||
      location.port ||
      !['.blob.core.windows.net', '.actions.githubusercontent.com'].some((host) =>
        location.hostname.endsWith(host),
      )
    )
      throw new AppError('LOG_HOST', 'GitHub log redirect host is not allowed');
    const log = await (this.options.fetch ?? fetch)(location, {
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
    });
    if (!log.ok || !log.body) throw new GitHubError(log.status);
    const reader = log.body.getReader(),
      chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        size += part.value.length;
        if (size > 2_000_000) throw new AppError('LOG_SIZE', 'Log exceeds 2 MB');
        chunks.push(part.value);
      }
    } finally {
      await reader.cancel();
    }
    return Buffer.concat(chunks).toString('utf8');
  }
}
export function appJwt(appId: string, key: string, now = Date.now()): string {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({ iat: Math.floor(now / 1000) - 60, exp: Math.floor(now / 1000) + 540, iss: appId }),
  ).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${createSign('RSA-SHA256').update(input).sign(key, 'base64url')}`;
}
export function installationClient(
  appId: string,
  key: string,
  installationId: number,
  repositoryIds?: number[],
): GitHubClient {
  let cached: { token: string; expires_at: string } | undefined;
  return new GitHubClient({
    token: async () => {
      if (!cached || Date.parse(cached.expires_at) - 60000 < Date.now()) {
        const app = new GitHubClient({ token: async () => appJwt(appId, key) });
        cached = await app.request<{ token: string; expires_at: string }>(
          `/app/installations/${installationId}/access_tokens`,
          'POST',
          repositoryIds ? { repository_ids: repositoryIds } : {},
        );
      }
      return cached.token;
    },
  });
}
