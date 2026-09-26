import { execFile } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { expect, it } from 'vitest';

const run = promisify(execFile);
const cli = (...args: string[]) =>
  run(
    process.execPath,
    [
      '--import',
      pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,
      resolve('packages/cli/src/main.ts'),
      ...args,
    ],
    { timeout: 15000 },
  );
it('uses --version as the release input rather than exiting with the CLI version', async () => {
  const { stdout } = await cli(
    '--json',
    'release',
    'prepare',
    '--version',
    '1.0.0',
    '--commits',
    'examples/commits.json',
  );
  expect(JSON.parse(stdout)).toMatchObject({ version: '1.1.0', published: false });
});
it('reports unknown remote health signals rather than inventing zeroes', async () => {
  const { stdout } = await cli('--json', 'repo', 'health', 'fixtures/typescript-library');
  expect(JSON.parse(stdout).signals).toMatchObject({
    oldPullRequests: null,
    unansweredIssues: null,
    defaultBranchFailing: null,
  });
});
it('validates the shipped policy example and exposes explicit CLI version', async () => {
  expect((await cli('config', 'validate', 'examples/policies.yml')).stdout).toContain('valid');
  expect((await cli('--cli-version')).stdout.trim()).toBe('0.1.0');
});
