import { createHash, randomBytes } from 'node:crypto';
import { z } from 'zod';
export const repositoryName = z
  .string()
  .max(200)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*\/[A-Za-z0-9][A-Za-z0-9_.-]*$/);
export const positiveId = z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER);
export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
  }
}
export function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
export function opaqueId(): string {
  return randomBytes(24).toString('hex');
}
export function redact(value: string): string {
  return value
    .replace(
      /-----BEGIN [^-]*PRIVATE KEY-----[\s\S]*?-----END [^-]*PRIVATE KEY-----/g,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(
      /(["']?(?:password|secret|token|api[_-]?key)["']?\s*[:=]\s*)(["'])([^\r\n]*?)\2/gi,
      '$1"[REDACTED]"',
    )
    .replace(/(Bearer\s+)[^\s"']+/gi, '$1[REDACTED]')
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|sk-[A-Za-z0-9_-]+)\b/g, '[REDACTED]')
    .replace(/((?:password|secret|token|api[_-]?key)\s*[:=]\s*)[^\s,;"']+/gi, '$1[REDACTED]');
}
export function safePath(value: string): string {
  if (
    !value ||
    value.length > 1024 ||
    value.includes('\\') ||
    value.startsWith('/') ||
    value.includes('\0') ||
    value.split('/').some((p) => p === '..' || p === '.') ||
    /^[a-z]:/i.test(value)
  )
    throw new AppError('UNSAFE_PATH', 'Repository paths must be relative and cannot traverse directories');
  return value;
}
export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function textField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}
export function numeric(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
export function boundedText(value: string, maximum = 100_000): string {
  if (Buffer.byteLength(value) > maximum)
    throw new AppError('INPUT_TOO_LARGE', 'Input exceeds configured size limit', 413);
  return value;
}
export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Match a whole repository path, allowing an absolute runner prefix but not a filename suffix. */
export function hasPathMention(text: string, path: string): boolean {
  if (!path) return false;
  const normalized = text.replaceAll('\\', '/');
  let offset = normalized.indexOf(path);
  while (offset >= 0) {
    const before = normalized[offset - 1] ?? '',
      after = normalized[offset + path.length] ?? '';
    if (!/[A-Za-z0-9_.-]/.test(before) && !/[A-Za-z0-9_./-]/.test(after)) return true;
    offset = normalized.indexOf(path, offset + 1);
  }
  return false;
}
