import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { analyzeCi } from '@openmaintainer/ci-analysis';
import { parseConfig } from '@openmaintainer/config';
import { GitHubClient, issueFromGitHub, pullRequestSource } from '@openmaintainer/github';
import { analyzeIssue, findDuplicates } from '@openmaintainer/issue-triage';
import {
  type Capability,
  capabilities,
  invokePlugin,
  loadRegistry,
  manifestSchema,
} from '@openmaintainer/plugin-sdk';
import { analyzePullRequest } from '@openmaintainer/pr-analysis';
import {
  type Change,
  type Commit,
  parseChangeset,
  prepareRelease,
  validateRelease,
} from '@openmaintainer/release-engine';
import { analyzeRepository, readRepository, repositoryHealth } from '@openmaintainer/repository-analysis';
import { AppError, asRecord, positiveId, repositoryName, textField } from '@openmaintainer/shared';
import type { Command } from 'commander';
import { z } from 'zod';
export function registerCommands(cli: Command): void {
  cli
    .option('--repo <owner/name>', 'GitHub repository')
    .option('--token-env <name>', 'Environment variable containing a GitHub token', 'GITHUB_TOKEN');
  const output = (value: unknown) => {
    if (!cli.opts().quiet) {
      if (cli.opts().json) console.log(JSON.stringify(value));
      else console.log(JSON.stringify(value, null, 2));
    }
  };
  const gh = () => {
    const variable = String(cli.opts().tokenEnv);
    if (!/^[A-Z_][A-Z0-9_]*$/.test(variable))
      throw new AppError('TOKEN_ENV', 'Invalid environment variable name');
    const token = process.env[variable];
    if (!token) throw new AppError('AUTH', `Set ${variable} to a GitHub token with repository access`);
    return new GitHubClient({ token: async () => token });
  };
  const repo = () => repositoryName.parse(cli.opts().repo);
  const repository = cli.command('repo').description('Analyze local repository structure');
  repository
    .command('scan')
    .argument('[directory]', 'Repository directory', '.')
    .action(async (directory: string) => output(analyzeRepository(await readRepository(directory))));
  repository
    .command('health')
    .argument('[directory]', 'Repository directory', '.')
    .action(async (directory: string) =>
      output(
        repositoryHealth({
          remoteDataAvailable: false,
          profile: analyzeRepository(await readRepository(directory)),
          openPullRequests: [],
          openIssues: [],
          defaultBranchCi: 'unknown',
        }),
      ),
    );
  const pr = cli.command('pr');
  pr.command('analyze')
    .argument('<number>')
    .action(async (value: string) => {
      const source = await pullRequestSource(gh(), repo(), positiveId.parse(value));
      output(analyzePullRequest(source.files, { body: textField(source.pr.body) }));
    });
  const issue = cli.command('issue');
  issue
    .command('analyze')
    .argument('<number>')
    .action(async (value: string) => {
      const client = gh(),
        data = await client.request<Record<string, unknown>>(
          `${client.repoPath(repo())}/issues/${positiveId.parse(value)}`,
        );
      output(analyzeIssue(issueFromGitHub(data)));
    });
  issue
    .command('duplicates')
    .argument('<number>')
    .action(async (value: string) => {
      const client = gh(),
        base = `${client.repoPath(repo())}/issues`,
        number = positiveId.parse(value);
      const [target, items] = await Promise.all([
        client.request<Record<string, unknown>>(`${base}/${number}`),
        client.paginate<Record<string, unknown>>(`${base}?state=all`),
      ]);
      output(
        findDuplicates(issueFromGitHub(target), items.filter((i) => !i.pull_request).map(issueFromGitHub)),
      );
    });
  cli
    .command('ci')
    .command('analyze')
    .argument('<run-or-log>')
    .description('Analyze a log file, or a numeric GitHub workflow run with --repo')
    .action(async (value: string) => {
      if (!/^\d+$/.test(value)) {
        output(analyzeCi(await readFile(resolve(value), 'utf8')));
        return;
      }
      const client = gh(),
        jobs = await client.request<{ jobs: { id: number; name: string; conclusion: string }[] }>(
          `${client.repoPath(repo())}/actions/runs/${positiveId.parse(value)}/jobs?per_page=100`,
        );
      const results = [];
      for (const job of jobs.jobs.filter((j) => ['failure', 'timed_out'].includes(j.conclusion)).slice(0, 10))
        results.push({ job: job.name, ...analyzeCi(await client.jobLog(repo(), job.id)) });
      output({ diagnostics: results, scope: 'First 100 jobs; up to 10 failed logs' });
    });
  const releases = cli.command('release');
  for (const name of ['status', 'prepare', 'notes']) {
    releases
      .command(name)
      .requiredOption('--version <semver>', 'Current version')
      .requiredOption('--commits <file>', 'JSON array of {sha,message}')
      .option('--changeset <file>', 'Changeset markdown file')
      .option('--package <name>', 'Package name for a changeset')
      .option('--rc <number>', 'Release candidate number')
      .option('--output <file>', 'Write notes to a new file')
      .action(
        async (options: {
          version: string;
          commits: string;
          changeset?: string;
          package?: string;
          rc?: string;
          output?: string;
        }) => {
          const commits = z
            .array(z.object({ sha: z.string(), message: z.string() }))
            .parse(JSON.parse(await readFile(options.commits, 'utf8'))) as Commit[];
          const changes: Change[] = [];
          if (options.changeset) {
            const c = parseChangeset(await readFile(options.changeset, 'utf8')),
              bump = c.packages[options.package ?? ''];
            if (!bump) throw new AppError('CHANGESET_PACKAGE', 'Choose a package named in the changeset');
            changes.push({ bump, description: c.description });
          }
          const result = prepareRelease(
            options.version,
            commits,
            changes,
            options.rc ? Number(options.rc) : undefined,
          );
          if (options.output) await writeFile(options.output, result.notes, { flag: 'wx' });
          output(name === 'notes' ? result.notes : result);
        },
      );
  }
  releases
    .command('validate')
    .requiredOption('--version <semver>')
    .requiredOption('--notes <file>')
    .option('--tags <file>', 'JSON list of existing tags')
    .action(async (options: { version: string; notes: string; tags?: string }) => {
      const errors = validateRelease(
        options.version,
        await readFile(options.notes, 'utf8'),
        options.tags ? z.array(z.string()).parse(JSON.parse(await readFile(options.tags, 'utf8'))) : [],
      );
      output({ valid: !errors.length, errors });
      if (errors.length) process.exitCode = 2;
    });
  const automations = cli.command('automations');
  for (const name of ['list', 'validate'])
    automations
      .command(name)
      .argument('[file]', 'Configuration', '.openmaintainer.yml')
      .action(async (file: string) => {
        const config = parseConfig(await readFile(file, 'utf8'));
        output(
          name === 'list' ? config.rules : { valid: true, rules: config.rules.length, dryRun: config.dryRun },
        );
      });
  const plugins = cli.command('plugin');
  const registry = resolve('.openmaintainer', 'plugins.json');
  plugins
    .command('run')
    .argument('<name>')
    .requiredOption('--capability <capability>')
    .requiredOption('--input <file>', 'JSON capability input')
    .action(async (name: string, options: { capability: string; input: string }) => {
      const manifests = await loadRegistry(registry),
        plugin = manifests.find((m) => m.name === name);
      if (!plugin) throw new AppError('PLUGIN_NOT_FOUND', 'Register a trusted plugin first');
      if (!capabilities.includes(options.capability as Capability))
        throw new AppError('PLUGIN_CAPABILITY', 'Unknown plugin capability');
      output(
        await invokePlugin(
          plugin,
          options.capability as Capability,
          JSON.parse(await readFile(options.input, 'utf8')),
        ),
      );
    });
  plugins.command('list').action(async () => {
    try {
      output(JSON.parse(await readFile(registry, 'utf8')));
    } catch (error) {
      if (asRecord(error).code === 'ENOENT') output([]);
      else throw error;
    }
  });
  plugins
    .command('install')
    .argument('<manifest>')
    .requiredOption('--trust-code', 'Acknowledge that local plugins execute trusted operator code')
    .description('Register a local plugin manifest; never downloads or runs an npm install script')
    .action(async (file: string) => {
      const manifest = manifestSchema.parse(JSON.parse(await readFile(resolve(file), 'utf8')));
      const entry = resolve(resolve(file, '..'), manifest.entry);
      if (!/\.(mjs|js)$/.test(entry))
        throw new AppError('PLUGIN_ENTRY', 'Build the plugin to a .js or .mjs entry before registration');
      await readFile(entry);
      let current: unknown[] = [];
      try {
        current = z.array(z.unknown()).parse(JSON.parse(await readFile(registry, 'utf8')));
      } catch (error) {
        if (asRecord(error).code !== 'ENOENT') throw error;
      }
      const next = [...current.filter((p) => asRecord(p).name !== manifest.name), { ...manifest, entry }];
      await mkdir(join(registry, '..'), { recursive: true });
      await writeFile(registry, JSON.stringify(next, null, 2));
      output({
        registered: manifest.name,
        entry,
        instruction:
          'Set OPENMAINTAINER_PLUGINS to this registry path in the worker environment to activate trusted plugin analyzers.',
      });
    });
}
