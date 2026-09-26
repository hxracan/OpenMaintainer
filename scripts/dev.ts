import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';

loadEnvFile('.env');

const children = [
  spawn(process.execPath, ['--env-file=.env', '--import', 'tsx', resolve('apps/api/src/main.ts')], {
    stdio: 'inherit',
  }),
  spawn(process.execPath, ['--env-file=.env', '--import', 'tsx', resolve('apps/worker/src/main.ts')], {
    stdio: 'inherit',
  }),
  spawn(
    process.execPath,
    [resolve('apps/dashboard/node_modules/next/dist/bin/next'), 'dev', '--hostname', '127.0.0.1'],
    {
      cwd: resolve('apps/dashboard'),
      stdio: 'inherit',
      env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' },
    },
  ),
];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => stop());
for (const child of children) child.on('exit', (code) => stop(code ?? 0));
