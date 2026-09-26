import { type AIProvider, advise, workflows } from '@openmaintainer/ai';
import {
  type ActionExecutor,
  type AutomationPlan,
  executePlan,
  renderTemplate,
} from '@openmaintainer/automation-engine';
import { analyzeCi } from '@openmaintainer/ci-analysis';
import { configSchema, defaultConfig } from '@openmaintainer/config';
import type { SourceFile } from '@openmaintainer/core';
import type { Database, Job } from '@openmaintainer/database';
import { audit, enqueue } from '@openmaintainer/database';
import { issueFromGitHub, pullRequestSource, repositorySource } from '@openmaintainer/github';
import { analyzeIssue, findDuplicates } from '@openmaintainer/issue-triage';
import { analyzeWithPlugins, type PluginManifest } from '@openmaintainer/plugin-sdk';
import { analyzePullRequest } from '@openmaintainer/pr-analysis';
import { type Commit, prepareRelease } from '@openmaintainer/release-engine';
import { analyzeRepository } from '@openmaintainer/repository-analysis';
import { AppError, asRecord, digest, numeric, textField } from '@openmaintainer/shared';
import { type GitHubServices, processWebhook } from './webhooks.js';
export interface ProcessorOptions {
  db: Database;
  github: GitHubServices;
  allowWrites: boolean;
  demo?: boolean;
  demoSource?: SourceFile[];
  plugins?: PluginManifest[];
  ai?: AIProvider;
}
export function createProcessor(options: ProcessorOptions) {
  const { db } = options;
  return async (job: Job, signal: AbortSignal): Promise<unknown> => {
    if (job.kind === 'webhook.process') {
      if (options.demo) throw new AppError('DEMO', 'External integrations disabled');
      await processWebhook(db, options.github, textField(job.payload.deliveryId), options.allowWrites);
      return { processed: true };
    }
    const repo = (
      await db.query<{
        id: number;
        full_name: string;
        installation_id: number;
        default_branch: string;
        config: unknown;
      }>(
        'SELECT r.* FROM repositories r JOIN installations i ON i.id=r.installation_id WHERE r.id=$1 AND i.suspended=false AND r.archived=false',
        [job.repository_id],
      )
    ).rows[0];
    if (!repo) throw new AppError('NOT_FOUND', 'Active repository not found', 404);
    const repositoryId = Number(repo.id),
      gh = options.github.installation(Number(repo.installation_id), [repositoryId]),
      base = gh.repoPath(repo.full_name),
      number = numeric(job.payload.number);
    const save = async (kind: string, subject: string, fingerprint: string, result: unknown) => {
      await db.query(
        'INSERT INTO analyses(repository_id,kind,subject,fingerprint,result) VALUES($1,$2,$3,$4,$5) ON CONFLICT(repository_id,kind,subject,fingerprint) DO UPDATE SET result=EXCLUDED.result,created_at=now()',
        [repositoryId, kind, subject, fingerprint, JSON.stringify(result)],
      );
      return result;
    };
    const config = repo.config ? configSchema.parse(repo.config) : defaultConfig();
    signal.throwIfAborted();
    if (job.kind === 'ai.analyze') {
      if (options.demo || !config.ai.enabled || !options.ai)
        throw new AppError(
          'AI_DISABLED',
          'AI requires explicit repository opt-in and an operator-configured provider',
        );
      const workflow = job.payload.workflow;
      if (typeof workflow !== 'string' || !workflows.includes(workflow as (typeof workflows)[number]))
        throw new AppError('AI_WORKFLOW', 'Unknown AI workflow');
      const kinds = {
        'pr-explanation': 'pr.analyze',
        'issue-classification': 'issue.analyze',
        'ci-explanation': 'ci.analyze',
        'duplicate-verification': 'issue.duplicates',
        'release-notes': 'release.prepare',
        'maintainer-report': 'repository.index',
      } as const;
      const kind = kinds[workflow as keyof typeof kinds];
      const subject = workflow === 'maintainer-report' ? 'repository' : textField(job.payload.subject);
      const evidence = (
        await db.query<{ result: unknown }>(
          'SELECT result FROM analyses WHERE repository_id=$1 AND kind=$2 AND subject=$3 ORDER BY created_at DESC LIMIT 1',
          [repositoryId, kind, subject],
        )
      ).rows[0];
      if (!evidence) throw new AppError('AI_EVIDENCE', 'Run the deterministic analysis first');
      const reservation = await db.transaction(async (tx) => {
        await tx.query('SELECT id FROM repositories WHERE id=$1 FOR UPDATE', [repositoryId]);
        if ((await tx.query('SELECT id FROM ai_usage WHERE request_id=$1', [job.id])).rows.length)
          throw new AppError(
            'AI_FAILED',
            'A provider request was already reserved for this job; reconcile its outcome before requesting again',
          );
        const limit =
          (
            await tx.query<{ count: number }>(
              "SELECT count(*)::int AS count FROM ai_usage WHERE repository_id=$1 AND created_at>now()-interval '1 day'",
              [repositoryId],
            )
          ).rows[0]?.count ?? 0;
        if (limit >= 100) throw new AppError('AI_BUDGET', 'Daily repository AI request limit reached');
        return (
          await tx.query<{ id: number }>(
            "INSERT INTO ai_usage(repository_id,model,input_tokens,output_tokens,request_id) VALUES($1,'pending-or-unknown',0,0,$2) RETURNING id",
            [repositoryId, job.id],
          )
        ).rows[0]?.id;
      });
      let answer: Awaited<ReturnType<typeof advise>>;
      try {
        answer = await advise(options.ai, workflow as (typeof workflows)[number], evidence.result, signal);
      } catch {
        throw new AppError(
          'AI_FAILED',
          'AI request failed; it will not be retried automatically because usage may have been incurred',
        );
      }
      await db.query('UPDATE ai_usage SET model=$2,input_tokens=$3,output_tokens=$4 WHERE id=$1', [
        reservation,
        answer.usage.model,
        answer.usage.inputTokens,
        answer.usage.outputTokens,
      ]);
      await audit(db, 'worker', repositoryId, 'ai.advisory', workflow);
      return save('ai.analyze', subject, digest(JSON.stringify({ workflow, evidence: evidence.result })), {
        workflow,
        ...answer,
        advisory: true,
      });
    }
    if (['repository.index', 'repository.sync', 'scheduled.scan'].includes(job.kind)) {
      const source = options.demo
        ? { sha: digest(JSON.stringify(options.demoSource ?? [])), files: options.demoSource ?? [] }
        : await repositorySource(gh, repo.full_name, repo.default_branch);
      const cached = (
        await db.query<{ result: unknown }>(
          "SELECT result FROM analyses WHERE repository_id=$1 AND kind='repository.index' AND fingerprint=$2",
          [repositoryId, source.sha],
        )
      ).rows[0];
      const profile = cached?.result ?? analyzeRepository(source.files);
      if (options.plugins?.length) {
        const pluginResults = await analyzeWithPlugins(
          options.plugins,
          { repository: repo.full_name, files: source.files },
          signal,
        );
        await save('plugins.analyze', 'repository', source.sha, pluginResults);
      }
      await db.query('UPDATE repositories SET profile=$2,updated_at=now() WHERE id=$1', [
        repositoryId,
        JSON.stringify(profile),
      ]);
      if (!options.demo) {
        const [issues, prs, runs] = await Promise.all([
          gh.paginate<Record<string, unknown>>(`${base}/issues?state=open`),
          gh.paginate<Record<string, unknown>>(`${base}/pulls?state=open`),
          gh.request<{ workflow_runs: Record<string, unknown>[] }>(`${base}/actions/runs?per_page=30`),
        ]);
        await db.transaction(async (tx) => {
          await tx.query(
            "UPDATE issues SET data=jsonb_set(data,'{state}','\"closed\"') WHERE repository_id=$1",
            [repositoryId],
          );
          await tx.query(
            "UPDATE pull_requests SET data=jsonb_set(data,'{state}','\"closed\"') WHERE repository_id=$1",
            [repositoryId],
          );
          for (const issue of issues.filter((i) => !i.pull_request))
            await tx.query(
              'INSERT INTO issues(repository_id,number,data) VALUES($1,$2,$3) ON CONFLICT(repository_id,number) DO UPDATE SET data=EXCLUDED.data,updated_at=now()',
              [repositoryId, numeric(issue.number), JSON.stringify(issue)],
            );
          for (const pr of prs)
            await tx.query(
              'INSERT INTO pull_requests(repository_id,number,data) VALUES($1,$2,$3) ON CONFLICT(repository_id,number) DO UPDATE SET data=EXCLUDED.data,updated_at=now()',
              [repositoryId, numeric(pr.number), JSON.stringify(pr)],
            );
          for (const run of runs.workflow_runs)
            await tx.query(
              'INSERT INTO workflow_runs(repository_id,id,data) VALUES($1,$2,$3) ON CONFLICT(repository_id,id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()',
              [repositoryId, numeric(run.id), JSON.stringify(run)],
            );
        });
      }
      await audit(db, 'worker', repositoryId, 'repository.analyzed', source.sha);
      if (job.kind === 'scheduled.scan') {
        const { queueAutomations } = await import('./webhooks.js');
        await queueAutomations(
          db,
          config,
          {
            id: job.id,
            trigger: 'scheduled.scan',
            repository: repo.full_name,
            repositoryId,
            installationId: Number(repo.installation_id),
            actor: 'scheduler',
            facts: { branch: repo.default_branch },
          },
          options.allowWrites,
        );
      }
      return save('repository.index', 'repository', source.sha, profile);
    }
    if (job.kind === 'pr.analyze') {
      if (options.demo) throw new AppError('DEMO', 'Use the seeded PR analysis in demo mode');
      const { pr, files, head } = await pullRequestSource(gh, repo.full_name, number);
      await db.query(
        'INSERT INTO pull_requests(repository_id,number,data) VALUES($1,$2,$3) ON CONFLICT(repository_id,number) DO UPDATE SET data=EXCLUDED.data,updated_at=now()',
        [repositoryId, number, JSON.stringify(pr)],
      );
      return save(
        job.kind,
        String(number),
        head,
        analyzePullRequest(files, {
          body: textField(pr.body),
          firstTimeContributor: ['FIRST_TIMER', 'FIRST_TIME_CONTRIBUTOR'].includes(
            textField(pr.author_association),
          ),
        }),
      );
    }
    if (job.kind === 'issue.analyze' || job.kind === 'issue.duplicates') {
      const raw = options.demo
        ? (
            await db.query<{ data: Record<string, unknown> }>(
              'SELECT data FROM issues WHERE repository_id=$1 AND number=$2',
              [repositoryId, number],
            )
          ).rows[0]?.data
        : await gh.request<Record<string, unknown>>(`${base}/issues/${number}`);
      if (!raw) throw new AppError('NOT_FOUND', 'Issue not found', 404);
      await db.query(
        'INSERT INTO issues(repository_id,number,data) VALUES($1,$2,$3) ON CONFLICT(repository_id,number) DO UPDATE SET data=EXCLUDED.data,updated_at=now()',
        [repositoryId, number, JSON.stringify(raw)],
      );
      const issue = issueFromGitHub(raw);
      const others =
        job.kind === 'issue.duplicates'
          ? (
              await db.query<{ data: Record<string, unknown> }>(
                'SELECT data FROM issues WHERE repository_id=$1 ORDER BY updated_at DESC LIMIT 1000',
                [repositoryId],
              )
            ).rows.map((r) => issueFromGitHub(r.data))
          : [];
      return save(
        job.kind,
        String(number),
        digest(JSON.stringify(raw)),
        job.kind === 'issue.duplicates'
          ? {
              candidates: findDuplicates(issue, others),
              scope: 'Most recent 1000 locally synchronized issues',
            }
          : analyzeIssue(issue, { labels: config.labels, staleDays: config.staleDays }),
      );
    }
    if (job.kind === 'ci.analyze') {
      if (options.demo) throw new AppError('DEMO', 'Use seeded CI diagnostics in demo mode');
      const run = await gh.request<Record<string, unknown>>(`${base}/actions/runs/${number}`);
      await db.query(
        'INSERT INTO workflow_runs(repository_id,id,data) VALUES($1,$2,$3) ON CONFLICT(repository_id,id) DO UPDATE SET data=EXCLUDED.data,updated_at=now()',
        [repositoryId, number, JSON.stringify(run)],
      );
      const jobs = await gh.request<{ jobs: Record<string, unknown>[] }>(
        `${base}/actions/runs/${number}/jobs?per_page=100`,
      );
      const diagnostics = [];
      for (const item of jobs.jobs
        .filter((j) => ['failure', 'timed_out'].includes(textField(j.conclusion)))
        .slice(0, 10)) {
        const log = await gh.jobLog(repo.full_name, numeric(item.id));
        diagnostics.push({ jobId: item.id, name: item.name, ...analyzeCi(log) });
      }
      return save(job.kind, String(number), digest(JSON.stringify(run)), {
        diagnostics,
        scope: 'First 100 jobs, up to 10 failed job logs',
      });
    }
    if (job.kind === 'release.prepare') {
      const input = asRecord(job.payload),
        version = textField(input.version);
      let commits = Array.isArray(input.commits)
        ? (input.commits.map((c) => ({
            sha: textField(asRecord(c).sha),
            message: textField(asRecord(c).message),
          })) as Commit[])
        : [];
      if (input.fromRef && !options.demo) {
        const comparison = await gh.request<{
          total_commits: number;
          commits: { sha: string; commit: { message: string } }[];
        }>(
          `${base}/compare/${encodeURIComponent(textField(input.fromRef))}...${encodeURIComponent(repo.default_branch)}`,
        );
        if (comparison.total_commits !== comparison.commits.length)
          throw new AppError('RELEASE_RANGE', 'Commit range exceeds the supported comparison size');
        commits = comparison.commits.map((c) => ({ sha: c.sha, message: c.commit.message }));
      }
      const result = prepareRelease(version, commits);
      await db.query(
        'INSERT INTO releases(repository_id,version,data) VALUES($1,$2,$3) ON CONFLICT(repository_id,version) DO UPDATE SET data=EXCLUDED.data',
        [repositoryId, result.version, JSON.stringify(result)],
      );
      await audit(db, 'worker', repositoryId, 'release.prepared', result.version);
      return save('release.prepare', result.version, digest(JSON.stringify(result)), result);
    }
    if (job.kind === 'notification.send') {
      if (!config.notifications.dashboard && !config.notifications.console)
        return { delivered: false, disabled: true };
      const message = textField(job.payload.message).slice(0, 10000),
        id = digest(job.id);
      const inserted = await db.query(
        'INSERT INTO notifications(id,repository_id,channel,message) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING RETURNING id',
        [id, repositoryId, config.notifications.dashboard ? 'dashboard' : 'console', message],
      );
      if (config.notifications.console && inserted.rows.length)
        console.info(JSON.stringify({ event: 'notification', repositoryId, notificationId: id }));
      return { delivered: config.notifications.dashboard, notificationId: id };
    }
    if (job.kind === 'automation.execute') {
      const plan = job.payload.plan as AutomationPlan;
      const approved = (
        await db.query<{ rule: { enabled?: boolean; then?: unknown } }>(
          'SELECT rule FROM automation_rules WHERE repository_id=$1 AND id=$2',
          [repositoryId, plan.ruleId],
        )
      ).rows[0]?.rule;
      if (
        !approved ||
        approved.enabled === false ||
        JSON.stringify(approved.then) !== JSON.stringify(plan.actions)
      )
        throw new AppError('PLAN_CHANGED', 'Automation rule changed or was disabled after planning');
      if (plan.event.repositoryId !== repositoryId)
        throw new AppError('PLAN_SCOPE', 'Automation repository mismatch');
      plan.dryRun = plan.dryRun || options.demo === true || !options.allowWrites || config.dryRun;
      const executor: ActionExecutor = {
        execute: async (action, event, key) => {
          signal.throwIfAborted();
          if (
            ['addLabel', 'removeLabel', 'assignUser', 'requestReviewer', 'postComment'].includes(
              action.type,
            ) &&
            !event.subjectNumber
          )
            throw new AppError('ACTION_SUBJECT', 'Action requires an issue or PR');
          const subject = `${base}/issues/${event.subjectNumber}`;
          switch (action.type) {
            case 'addLabel':
              return gh.request(`${subject}/labels`, 'POST', { labels: [action.value] });
            case 'removeLabel':
              return gh.request(`${subject}/labels/${encodeURIComponent(action.value)}`, 'DELETE');
            case 'assignUser':
              return gh.request(`${subject}/assignees`, 'POST', { assignees: [action.value] });
            case 'requestReviewer':
              return gh.request(`${base}/pulls/${event.subjectNumber}/requested_reviewers`, 'POST', {
                reviewers: [action.value],
              });
            case 'postComment':
              return gh.request(`${subject}/comments`, 'POST', {
                body: `${renderTemplate(action.value, event)}\n<!-- openmaintainer:${key} -->`,
              });
            case 'createIssue':
              return gh.request(`${base}/issues`, 'POST', {
                title: renderTemplate(action.title, event),
                body: renderTemplate(action.body, event),
              });
            case 'sendNotification':
              if (config.notifications.githubComment && event.subjectNumber) {
                await gh.request(`${subject}/comments`, 'POST', {
                  body: `${renderTemplate(action.value, event)}\n<!-- openmaintainer:${key} -->`,
                });
              }
              return enqueue(
                db,
                'notification.send',
                { message: renderTemplate(action.value, event) },
                repositoryId,
                key,
              );
            case 'queueAnalysis':
              return enqueue(db, action.value, { number: event.subjectNumber }, repositoryId, key);
          }
        },
      };
      await executePlan(db, plan, executor, signal);
      return { dryRun: plan.dryRun };
    }
    throw new AppError('JOB_KIND', `Unsupported job kind: ${job.kind}`);
  };
}
