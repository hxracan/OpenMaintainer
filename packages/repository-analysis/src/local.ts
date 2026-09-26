import { lstat, readdir, readFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import type { SourceFile } from '@openmaintainer/core';
import { AppError } from '@openmaintainer/shared';

const excluded = new Set([
  '.git',
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.turbo',
  '.venv',
  'vendor',
]);
export async function readRepository(root: string): Promise<SourceFile[]> {
  const base = resolve(root),
    files: SourceFile[] = [];
  let bytes = 0;
  async function visit(dir: string): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (excluded.has(entry.name) || entry.isSymbolicLink()) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(absolute);
        continue;
      }
      if (!entry.isFile()) continue;
      const path = relative(base, absolute).replaceAll('\\', '/'),
        stat = await lstat(absolute);
      if (files.length >= 10000)
        throw new AppError('SCAN_LIMIT', 'More than 10000 files; scan a smaller workspace');
      let content = '';
      if (stat.size < 250000 && !/\.(png|jpg|gif|zip|gz|woff2?|pdf|mp4|ico|lock)$/i.test(path)) {
        const data = await readFile(absolute);
        if (!data.includes(0)) {
          bytes += data.length;
          if (bytes > 20_000_000)
            throw new AppError('SCAN_LIMIT', 'Text exceeds 20 MB; scan a smaller workspace');
          content = data.toString('utf8');
        }
      }
      files.push({ path, content });
    }
  }
  await visit(base);
  return files;
}
