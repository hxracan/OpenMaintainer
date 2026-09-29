import { expect, it, vi } from 'vitest';
import {
  investigatePublicPullRequest,
  parsePublicPullRequest,
} from '../apps/api/src/public-investigation.js';

const base = 'a'.repeat(40),
  head = 'b'.repeat(40),
  mergeBase = 'c'.repeat(40);
const pr = {
  title: 'Change API',
  changed_files: 1,
  base: { sha: base, repo: { full_name: 'owner/project', private: false } },
  head: { sha: head, repo: { full_name: 'contributor/fork', private: false } },
};
const file = { filename: 'src/api.ts', status: 'modified', additions: 1, deletions: 1 };
function fixture(
  options: {
    moving?: boolean;
    truncated?: boolean;
    missingContent?: boolean;
    symlink?: boolean;
    files?: number;
    rename?: boolean;
  } = {},
) {
  let reads = 0;
  return vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/pulls/12')) {
      reads++;
      return Response.json({
        ...pr,
        changed_files: options.files ?? 1,
        ...(options.moving && reads > 1 ? { head: { ...pr.head, sha: 'd'.repeat(40) } } : {}),
      });
    }
    if (url.pathname.endsWith('/files'))
      return Response.json(
        Array.from({ length: options.files ?? 1 }, (_, index) => ({
          ...file,
          filename: index === 0 ? file.filename : `src/api${index}.ts`,
          ...(options.rename ? { status: 'renamed', previous_filename: 'src/previous.ts' } : {}),
        })),
      );
    if (url.pathname.includes('/compare/')) return Response.json({ merge_base_commit: { sha: mergeBase } });
    if (url.pathname.includes('/git/trees/'))
      return Response.json({
        truncated: options.truncated ?? false,
        tree: Array.from({ length: options.files ?? 1 }, (_, index) => ({
          path:
            options.rename && url.pathname.endsWith(mergeBase)
              ? 'src/previous.ts'
              : index === 0
                ? file.filename
                : `src/api${index}.ts`,
          type: 'blob',
          mode: options.symlink ? '120000' : '100644',
        })),
      });
    if (url.pathname.includes('/contents/')) {
      if (options.missingContent) return new Response('', { status: 404 });
      const content =
        url.searchParams.get('ref') === mergeBase
          ? 'export function api() {}'
          : 'export function api(required: string) {}';
      return Response.json({
        type: 'file',
        encoding: 'base64',
        size: content.length,
        content: Buffer.from(content).toString('base64'),
      });
    }
    throw new Error(`Unexpected fixture URL: ${url.pathname}`);
  });
}
it('accepts only exact HTTPS public PR URLs', () => {
  expect(parsePublicPullRequest('https://github.com/owner/project/pull/12')).toEqual({
    name: 'owner/project',
    number: 12,
  });
  for (const value of [
    'https://evil.test/owner/project/pull/12',
    'https://github.com@evil.test/owner/project/pull/12',
    'http://github.com/owner/project/pull/12',
    'https://github.com/owner/project/pull/0',
    'https://github.com/owner/project/pull/12/files',
    'https://github.com/owner/project/pull/12?token=secret',
  ])
    expect(() => parsePublicPullRequest(value)).toThrow();
});
it('reads merge-base and pinned fork head content with no credentials or redirects', async () => {
  const fetcher = fixture();
  const result = await investigatePublicPullRequest(
    { url: 'https://github.com/owner/project/pull/12' },
    fetcher,
  );
  expect(result.source).toMatchObject({ base: mergeBase, head, headRepository: 'contributor/fork' });
  expect(result.contracts.changes[0]?.kind).toBe('required-parameter');
  expect(result.coverage).toMatchObject({ changedFiles: 1, completeVersions: 1 });
  const urls = fetcher.mock.calls.map(([url]) => String(url));
  expect(urls).toContain(`https://api.github.com/repos/owner/project/contents/src/api.ts?ref=${mergeBase}`);
  expect(urls).toContain(`https://api.github.com/repos/contributor/fork/contents/src/api.ts?ref=${head}`);
  for (const [, options] of fetcher.mock.calls) {
    expect(options?.redirect).toBe('error');
    expect(new Headers(options?.headers).has('authorization')).toBe(false);
  }
});
it('rejects moving PRs and truncated trees instead of claiming complete evidence', async () => {
  await expect(
    investigatePublicPullRequest(
      { url: 'https://github.com/owner/project/pull/12' },
      fixture({ moving: true }),
    ),
  ).rejects.toThrow('changed during');
  await expect(
    investigatePublicPullRequest(
      { url: 'https://github.com/owner/project/pull/12' },
      fixture({ truncated: true }),
    ),
  ).rejects.toThrow('Complete base/head trees');
});
it('reports unavailable versions, skips symlinks and uses previous paths on renames', async () => {
  const missing = await investigatePublicPullRequest(
    { url: 'https://github.com/owner/project/pull/12' },
    fixture({ missingContent: true }),
  );
  expect(missing.coverage.uninspected).toEqual(['src/api.ts']);
  const symlinks = fixture({ symlink: true });
  expect(
    (await investigatePublicPullRequest({ url: 'https://github.com/owner/project/pull/12' }, symlinks))
      .coverage.completeVersions,
  ).toBe(0);
  expect(symlinks.mock.calls.some(([url]) => String(url).includes('/contents/'))).toBe(false);
  const renamed = fixture({ rename: true });
  const report = await investigatePublicPullRequest(
    { url: 'https://github.com/owner/project/pull/12' },
    renamed,
  );
  expect(report.contracts.changes[0]?.evidence[0]?.path).toBe('src/previous.ts');
});
it('caps full source inspection and exposes uninspected files', async () => {
  const report = await investigatePublicPullRequest(
    { url: 'https://github.com/owner/project/pull/12' },
    fixture({ files: 9 }),
  );
  expect(report.coverage.completeVersions).toBe(8);
  expect(report.coverage.uninspected).toEqual(['src/api8.ts']);
  expect(report.source.requests).toBeLessThanOrEqual(24);
});
it('handles upstream limits and bounds streamed responses', async () => {
  await expect(
    investigatePublicPullRequest(
      { url: 'https://github.com/owner/project/pull/12' },
      vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 403 })),
    ),
  ).rejects.toThrow('rate limit');
  await expect(
    investigatePublicPullRequest(
      { url: 'https://github.com/owner/project/pull/12' },
      vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(5_000_001))),
    ),
  ).rejects.toThrow('bounded inspection');
});
