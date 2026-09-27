# Verification

This record separates executed checks from supplied but unexecuted deployment paths.

## Executed locally

Development environment: Windows, Node 24.14.1, pnpm 11.15.1.

- Foundation, analysis, policy/service and dashboard phases passed lint, strict type checking, unit/integration tests and production builds.
- Final lint and strict TypeScript checks: passed.
- Latest unit/integration/CLI suite: 57 tests passed across eleven files.
- Production build: all 20 build tasks passed, including Next.js and 13 documentation pages.
- Chromium: all six browser scenarios passed (public checker success/error UI, navigation, real background-job completion, guided setup and draft rule previews, duplicate checks and job history, mobile policy editing). Latest local run used ports 3100/4100 to leave a separate user's demo untouched.
- Public checker: one live anonymous scan of hxracan/OpenMaintainer succeeded. Automated upstream tests use fixtures, including URL validation, absent/private repositories, GitHub errors, response limits, truncated trees and symlink exclusion. The browser checker test uses a mocked report and does not claim a live GitHub browser integration test.
- Dependency audit at low severity: no known vulnerabilities reported after overriding the affected development esbuild version.
- Manual CLI checks: local scan, release preparation, shipped policy validation and diagnostic/version flags.

Tests use actual embedded PostgreSQL through PGlite; external HTTP boundaries are mocked. The demo's records are explicitly fictional. Browser startup waits for the API route, and tests do not reuse an unrelated running instance.

## Executed on GitHub Actions

[CI run 36278126622](https://github.com/hxracan/OpenMaintainer/actions/runs/36278126622) for commit fb373777966bb5931cc13d24edfe16a6571bef56 passed on Ubuntu with Node 24. Its recorded successful steps include frozen installation, lint, type checking, unit tests, the disposable PostgreSQL 17 concurrency test (`pnpm test:postgres`), production build, Chromium installation and all browser tests. [Dependency security](https://github.com/hxracan/OpenMaintainer/actions/runs/36278126735) also passed for that commit.

## Review findings addressed

Bounded the dashboard proxy while streaming request bodies; expanded quoted-token/private-key redaction; rejected unsupported YAML tags; fenced stale PR events; invalidated changed action plans; reserved AI requests before provider calls to block ambiguous replay; fixed dashboard refresh and a conflicting CLI release-version flag. Regression tests cover these behavior classes. No inappropriate TODO/FIXME stubs, ts-ignore directives or disabled tests were found in source.

## Not yet verified

- Real GitHub App installation, OAuth exchange, permission behavior and live external writes.
- Paid OpenAI requests with an operator's chosen model.
- Docker Compose startup (Docker was unavailable locally).
- Independent security audit, exhaustive compatibility or sustained load testing.

The passing networked PostgreSQL check does not validate a live GitHub App or the full Docker Compose deployment.
