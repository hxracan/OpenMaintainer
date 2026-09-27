# Threat model

## Assets and untrusted inputs

Assets include installation tokens/private keys, encrypted user OAuth tokens, repository access boundaries, private source/log excerpts, policy authority and external action integrity.

Treat GitHub issue/PR text, filenames, diffs, manifests, logs, webhook metadata and AI output as untrusted. Only instance operators may install executable plugins.

## Implemented controls

- HMAC-SHA256 over exact webhook bytes with constant-time comparison; delivery and payload-hash deduplication; enqueue and receipt in one transaction.
- GitHub identity verification and fresh user-repository intersection. Every data/job/config mutation is scoped; write endpoints require repository write/maintain/admin permission.
- Random, expiring, one-use OAuth state bound to an HttpOnly cookie. Session IDs are hashed in storage; token payloads use AES-256-GCM. Secure cookies require HTTPS configuration.
- Cookie-authenticated writes require the exact dashboard Origin. Unsupported authorization headers cannot bypass CSRF checks.
- Parameterized SQL; strict schemas; body/input/file count limits; no repository script execution; symlink skipping; path validation.
- Fixed API origins, no token-bearing cross-origin redirects, and bounded signed-log downloads.
- The anonymous public checker uses a fixed GitHub API origin, no credentials or redirects, bounded streamed responses, a shared deadline, per-peer throttling and a two-scan process concurrency limit. It reads no workspace data and never persists scanned repositories. Public exposure can still exhaust anonymous GitHub quotas; operators should apply edge rate limits. Dashboard-proxied users share the proxy's peer-IP allowance.
- Explicit dry-run and operator-write gates; immutable event keys; persistent pre-action claims and ambiguous-outcome blocking.
- AI receives untrusted material as user data, with no tools; outputs are validated and never executable policy.
- Plugin registration is local/trust-explicit. Worker-thread containment handles ordinary failures, not adversarial host access.

## Residual risks

This is not an audited security product. Pattern-based redaction can miss secrets. AI can hallucinate or be influenced by malicious text. A compromised operator/plugin has host privileges. Application rate limits are not shared across processes. Repository visibility can change between authorization and use. Remote writes cannot be made atomically with the local database.

The initial session flow reauthenticates on expiry and does not implement token refresh. Network response schemas rely partly on GitHub's documented API contract. CI artifacts, backups, reverse proxies and secrets management need separate operator controls.

Review tests/pipeline.test.ts, ai-plugins.test.ts and engines.test.ts for executable controls and limits. Mocked network tests are not a substitute for staging installation and independent review.
