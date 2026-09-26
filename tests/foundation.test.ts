import { describe, expect, it } from 'vitest';
import { redact, repositoryName } from '../packages/shared/src/index.js';

describe('foundation', () => {
  it('rejects unsafe repository paths', () => {
    expect(() => repositoryName.parse('../private')).toThrow();
    expect(repositoryName.parse('owner/repo')).toBe('owner/repo');
  });
  it('redacts credential values', () => {
    expect(redact('Authorization: Bearer abc123')).not.toContain('abc123');
    expect(redact('{"password":"sensitive value","token":"private"}')).not.toContain('sensitive');
    expect(redact('{"password":"sensitive value","token":"private"}')).not.toContain('private');
    expect(redact('-----BEGIN PRIVATE KEY-----\nprivate-material\n-----END PRIVATE KEY-----')).not.toContain(
      'private-material',
    );
  });
});
