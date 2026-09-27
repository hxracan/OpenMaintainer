# Changelog

## Unreleased

- Added a public repository URL checker with six maintenance-file checks, anonymous bounded GitHub reads, actionable findings and explicit analysis limits. Available without sign-in, including in demo mode.

- Added Getting Started guidance inside the dashboard.
- Added draft automation previews with per-condition explanations and enforced dry-run behavior.
- Exposed issue duplicate analysis and saved candidates in the dashboard.
- Added job search within each page, repository names, execution history and queued-job cancellation.
- Fixed dashboard refresh, stale policy-loading responses and background polling after navigation.
- Recorded job cancellation in job history atomically.

## 0.1.0 — initial implementation

- Deterministic repository, PR, issue, CI and release analysis.
- GitHub App integration, scoped dashboard access and transactional job processing.
- Explicit automation policies, dry-run defaults and persistent action ledger.
- Optional advisory AI with bounded structured output.
- Trusted plugin SDK and three example analyzers.
- Isolated demo, documentation, deployment configuration and test suites.

This entry describes source functionality, not a published npm package or hosted service.
