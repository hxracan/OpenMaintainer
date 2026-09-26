# Contributing

Start with the credential-free demo and the architecture guide. Node 24 and pnpm 11.15.1 are required. Install with `pnpm install --frozen-lockfile`.

Discuss significant behavior changes in an issue before implementing them. Small bug fixes can go directly to a pull request with a reproduction and test. Do not include secrets, private repository text or unredacted CI logs.

## Checks

Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`. For dashboard changes install Chromium with `pnpm exec playwright install chromium` and run `pnpm test:e2e`. Close other demo processes first. Use `pnpm format` for formatting.

Keep pure analyzers independent of I/O. Add deterministic fixtures and assert both expected findings and false-positive cases. Integration tests belong in `tests/`; the test helper creates fresh embedded PostgreSQL databases. To test networked PostgreSQL set a disposable `TEST_DATABASE_URL`; never point it at production.

Use Conventional Commit titles such as `fix: fence expired workers`. Explain behavior, tests executed, known limitations and any migration in the PR. Do not inflate line counts or imply unexecuted tests passed.

## Security-sensitive changes

Authorization, webhook signature handling, session encryption, token forwarding, automation execution and plugin loading require focused adversarial tests. Never weaken a security check to accommodate a fixture. See SECURITY.md for private reporting.

## Maintainer workflow

Review CI results and inspect external-write boundaries before merging. Releases require an explicit maintainer decision; release automation creates build artifacts only. Changes to approved policies can affect future work, so keep new actions dry-run by default.
