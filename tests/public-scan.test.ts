import { expect, it, vi } from 'vitest';
import { parsePublicRepository, scanPublicRepository } from '../apps/api/src/public-scan.js';

const metadata = { private: false, default_branch: 'main', archived: false };
const tree = {
  sha: 'abc123',
  truncated: false,
  tree: [
    { path: 'README.md', type: 'blob', mode: '100644' },
    { path: 'src/index.ts', type: 'blob', mode: '100644' },
    { path: 'LICENSE', type: 'blob', mode: '120000' },
  ],
};
function transport(second: unknown = tree) {
  return vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json(metadata))
    .mockResolvedValueOnce(Response.json(second));
}
it('accepts repository names and HTTPS clone URLs but rejects arbitrary destinations', () => {
  expect(parsePublicRepository(' https://github.com/a/b.git/ ')).toBe('a/b');
  expect(parsePublicRepository('a/b')).toBe('a/b');
  for (const value of [
    'http://github.com/a/b',
    'https://evil.test/a/b',
    'https://github.com@evil.test/a/b',
    'https://github.com/a/b/tree/main',
    'a/../b',
    'a/b?token=secret',
    'https://github.com/a/b#readme',
  ])
    expect(() => parsePublicRepository(value)).toThrow();
});
it('reports real tree findings without credentials, file execution, or following redirects', async () => {
  const fetcher = transport();
  const result = await scanPublicRepository('a/b', fetcher);
  expect(result.fileCount).toBe(2);
  expect(result.languages).toEqual(['TypeScript']);
  expect(result.checks).toContainEqual({ id: 'readme', present: true });
  expect(result.checks).toContainEqual({ id: 'license', present: false });
  expect(result.findings).toHaveLength(5);
  expect(fetcher).toHaveBeenCalledTimes(2);
  expect(fetcher.mock.calls[1]?.[0]).toBe('https://api.github.com/repos/a/b/git/trees/main?recursive=1');
  expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe('error');
  expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has('authorization')).toBe(false);
});
it('does not produce misleading reports for truncated or oversized trees', async () => {
  await expect(scanPublicRepository('a/b', transport({ ...tree, truncated: true }))).rejects.toThrow(
    'complete-tree limit',
  );
  await expect(
    scanPublicRepository(
      'a/b',
      transport({ ...tree, tree: Array.from({ length: 10001 }, () => tree.tree[0]) }),
    ),
  ).rejects.toThrow('complete-tree limit');
});
it('explains private/missing repositories, rate limits, empty repositories, and network errors', async () => {
  for (const [status, message] of [
    [404, 'Public repository not found'],
    [403, 'limiting anonymous'],
    [429, 'limiting anonymous'],
    [409, 'no default-branch files'],
    [500, 'could not provide'],
  ] as const) {
    await expect(
      scanPublicRepository('a/b', vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status }))),
    ).rejects.toThrow(message);
  }
  await expect(
    scanPublicRepository('a/b', vi.fn<typeof fetch>().mockRejectedValue(new Error('secret detail'))),
  ).rejects.toThrow('could not be reached');
});
it('bounds streamed response size and rejects private metadata', async () => {
  await expect(
    scanPublicRepository('a/b', vi.fn<typeof fetch>().mockResolvedValue(new Response('x'.repeat(5_000_001)))),
  ).rejects.toThrow('5 MB');
  await expect(
    scanPublicRepository(
      'a/b',
      vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...metadata, private: true })),
    ),
  ).rejects.toThrow();
});
