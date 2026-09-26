import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const child = spawn(
  process.execPath,
  [resolve('node_modules/next/dist/bin/next'), ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, NEXT_TELEMETRY_DISABLED: '1' } },
);
child.once('error', () => {
  process.exitCode = 1;
});
child.once('exit', (code) => {
  process.exitCode = code ?? 1;
});
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => child.kill(signal));
