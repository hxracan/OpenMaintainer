import { expect, it, vi } from 'vitest';
import { GitHubClient } from '../packages/github/src/index.js';

it('rejects foreign origins before sending credentials', async () => {
  const request = vi.fn();
  const gh = new GitHubClient({ token: async () => 'secret', fetch: request });
  await expect(gh.request('//evil.example')).rejects.toThrow();
  expect(request).not.toHaveBeenCalled();
});
it('does not retry ambiguous writes', async () => {
  const request = vi.fn().mockResolvedValue(new Response('{}', { status: 503 }));
  const gh = new GitHubClient({ token: async () => 'secret', fetch: request });
  await expect(gh.request('/repos/a/b/issues', 'POST', {})).rejects.toThrow();
  expect(request).toHaveBeenCalledTimes(1);
});
