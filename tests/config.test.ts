import { expect, it } from 'vitest';
import { migrateConfig, parseConfig } from '../packages/config/src/index.js';

it('defaults to dry-run', () => expect(parseConfig('version: 1').dryRun).toBe(true));
it('rejects duplicate keys, tags, aliases and unknown config fields', () => {
  for (const source of [
    'version: 1\nversion: 1',
    'version: !!js/function hi',
    'version: 1\nlabels:\n  bug: !custom bug',
    'version: 1\nrules: &x [*x]',
    'version: 1\nshell: rm',
  ])
    expect(() => parseConfig(source)).toThrow();
});
it('migrates legacy rules without enabling writes', () =>
  expect(migrateConfig({ version: 0, automations: [] }).dryRun).toBe(true));
