import { readFile, writeFile } from 'node:fs/promises';
import { parseConfig } from '@openmaintainer/config';
import { Command } from 'commander';
import { registerCommands } from './commands.js';
export function createCli(): Command {
  const cli = new Command('openmaintainer')
    .description('Maintain repositories with deterministic analysis and explicit policies')
    .version('0.1.0', '-V, --cli-version', 'Print CLI version')
    .option('--json', 'Output JSON')
    .option('--quiet', 'Suppress successful output')
    .option('--verbose', 'Show diagnostic context');
  cli.hook('preAction', (_root, command) => {
    if (cli.opts().verbose)
      console.error(JSON.stringify({ command: command.name(), node: process.versions.node }));
  });
  cli
    .command('init')
    .description('Create a safe, dry-run configuration')
    .action(async () => {
      await writeFile('.openmaintainer.yml', 'version: 1\ndryRun: true\nrules: []\n', { flag: 'wx' });
      if (!cli.opts().quiet)
        console.log(
          cli.opts().json
            ? JSON.stringify({ created: '.openmaintainer.yml', dryRun: true })
            : 'Created .openmaintainer.yml',
        );
    });
  cli
    .command('doctor')
    .description('Check runtime and configuration')
    .action(async () => {
      const checks = {
        node: process.versions.node,
        githubToken: Boolean(process.env.GITHUB_TOKEN),
        database: Boolean(process.env.DATABASE_URL),
        ai: Boolean(process.env.OPENAI_API_KEY),
      };
      if (!cli.opts().quiet) console.log(JSON.stringify(checks, null, 2));
    });
  cli
    .command('config')
    .command('validate')
    .argument('[file]', 'Config file', '.openmaintainer.yml')
    .action(async (file: string) => {
      const result = parseConfig(await readFile(file, 'utf8'));
      if (!cli.opts().quiet) console.log(cli.opts().json ? JSON.stringify(result) : 'Configuration valid');
    });
  registerCommands(cli);
  return cli;
}
