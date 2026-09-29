import { investigateChanges } from '@openmaintainer/pr-analysis';

export function investigationExample() {
  const files = [
    {
      path: 'src/client.ts',
      status: 'modified' as const,
      additions: 4,
      deletions: 4,
      before:
        'export interface Options { timeout?: number; }\nexport function connect(url: string, retries = 3): string { return url; }\nexport const legacyConnect = connect;\n',
      after:
        'export interface Options { timeout: number; }\nexport function connect(url: string, token: string, retries = 0): string { return url + token; }\n',
      patch:
        '@@ -1,3 +1,2 @@\n-export interface Options { timeout?: number; }\n+export interface Options { timeout: number; }',
    },
    {
      path: 'config.json',
      status: 'modified' as const,
      additions: 1,
      deletions: 1,
      before: '{"timeout":3000}',
      after: '{"timeout":1000}',
    },
    {
      path: 'tests/unrelated.test.ts',
      status: 'modified' as const,
      additions: 1,
      deletions: 1,
      before: "test('math', () => expect(1).toBe(1));",
      after: "test('math', () => expect(2).toBe(2));",
    },
  ];
  return {
    ...investigateChanges(files, {
      issue: 'Regression in src/client.ts: connect now fails with our old URL-only call.',
      ciLog:
        'src/client.ts(2,18): error TS2554: Expected 2 arguments, but got 1.\nFAIL tests/client.test.ts\n',
      repositoryFiles: [
        ...files.map((file) => ({ path: file.path, content: file.after })),
        { path: 'tests/client.test.ts', content: '' },
      ],
    }),
    source: {
      example: true,
      repository: 'example/client-library',
      headRepository: 'example/client-library',
      title: 'Fictional example: change client authentication',
      number: 42,
      base: 'example-base',
      head: 'example-head',
      checkedAt: new Date().toISOString(),
    },
  };
}
