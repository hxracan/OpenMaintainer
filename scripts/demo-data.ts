import { analyzeCi } from '../packages/ci-analysis/src/index.js';
import type { Database } from '../packages/database/src/index.js';
import { analyzeIssue } from '../packages/issue-triage/src/index.js';
import { analyzePullRequest } from '../packages/pr-analysis/src/index.js';
import { analyzeRepository } from '../packages/repository-analysis/src/index.js';
export const demoFiles = [
  {
    path: 'package.json',
    content: JSON.stringify({
      name: 'example-library',
      version: '1.0.0',
      exports: './dist/index.js',
      devDependencies: { vitest: '5.0.2', typescript: '5.9.3' },
    }),
  },
  { path: 'src/index.ts', content: 'export function greet(name:string){ return name; }' },
  { path: 'README.md', content: '# Demo library' },
  { path: 'LICENSE', content: 'MIT' },
  { path: '.github/workflows/ci.yml', content: 'name: CI' },
  { path: 'pnpm-lock.yaml', content: '' },
];
export async function seedDemo(db: Database): Promise<void> {
  const profile = analyzeRepository(demoFiles);
  await db.transaction(async (tx) => {
    await tx.query("INSERT INTO installations(id,account) VALUES(1,'demo') ON CONFLICT(id) DO NOTHING");
    await tx.query(
      "INSERT INTO repositories(id,installation_id,full_name,profile) VALUES(1,1,'demo/example-library',$1) ON CONFLICT(id) DO NOTHING",
      [JSON.stringify(profile)],
    );
    const issue = {
      number: 12,
      title: 'Demo: crash when importing an empty configuration',
      body: 'Error after upgrading to version 1.0.0.',
      user: { login: 'demo-contributor' },
      state: 'open',
      labels: [{ name: 'bug' }],
      created_at: '2026-09-01T10:00:00Z',
      updated_at: '2026-09-02T10:00:00Z',
    };
    await tx.query('INSERT INTO issues(repository_id,number,data) VALUES(1,12,$1) ON CONFLICT DO NOTHING', [
      JSON.stringify(issue),
    ]);
    const pr = {
      number: 18,
      title: 'Demo: add a locale parameter',
      body: 'Fixes #12',
      state: 'open',
      user: { login: 'demo-contributor' },
      created_at: '2026-09-05T10:00:00Z',
      head: { sha: 'demo-head' },
      base: { sha: 'demo-base' },
      changed_files: 1,
      additions: 4,
      deletions: 2,
    };
    await tx.query(
      'INSERT INTO pull_requests(repository_id,number,data) VALUES(1,18,$1) ON CONFLICT DO NOTHING',
      [JSON.stringify(pr)],
    );
    const run = {
      id: 101,
      name: 'Demo: typecheck',
      head_branch: 'main',
      status: 'completed',
      conclusion: 'failure',
    };
    await tx.query(
      'INSERT INTO workflow_runs(repository_id,id,data) VALUES(1,101,$1) ON CONFLICT DO NOTHING',
      [JSON.stringify(run)],
    );
    const analyses = [
      [
        'pr.analyze',
        '18',
        analyzePullRequest([
          {
            path: 'src/index.ts',
            status: 'modified',
            additions: 4,
            deletions: 2,
            before: 'export function greet(name:string){return name}',
            after: 'export function greet(name:string,locale:string){return name+locale}',
          },
        ]),
      ],
      [
        'issue.analyze',
        '12',
        analyzeIssue({
          number: 12,
          title: issue.title,
          body: issue.body,
          author: 'demo',
          labels: ['bug'],
          state: 'open',
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
        }),
      ],
      ['ci.analyze', '101', analyzeCi('src/index.ts(3,4): error TS2554: Expected 2 arguments, but got 1.')],
    ];
    for (const [kind, subject, result] of analyses)
      await tx.query(
        "INSERT INTO analyses(repository_id,kind,subject,fingerprint,result) VALUES(1,$1,$2,'demo-v1',$3) ON CONFLICT DO NOTHING",
        [kind, subject, JSON.stringify(result)],
      );
    const existing = await tx.query("SELECT id FROM audit_events WHERE actor='demo-seed'");
    if (!existing.rows.length)
      await tx.query(
        "INSERT INTO audit_events(actor,repository_id,action,result) VALUES('demo-seed',1,'repository.analyzed','Fictional fixture analyzed by the real analysis engine'),('demo-seed',1,'demo.initialized','Local-only sample data')",
      );
  });
}
