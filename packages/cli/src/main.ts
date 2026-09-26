#!/usr/bin/env node
import { redact } from '@openmaintainer/shared';
import { createCli } from './index.js';

try {
  await createCli().parseAsync(process.argv);
} catch (error) {
  console.error(redact(error instanceof Error ? error.message : 'Command failed'));
  process.exitCode = 1;
}
