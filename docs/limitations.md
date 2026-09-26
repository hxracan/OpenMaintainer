# Scope and limitations

This source is an initial functional implementation, not a guarantee of production readiness, zero mistakes or OSS-program acceptance.

## Analysis

Remote trees are limited to 10,000 entries and up to 100 selected manifests. PRs are limited to 500 changed files, with complete versions for up to 80 relevant text files. The language inventory counts filenames, not lines of code. TypeScript breaking-change detection is conservative and file-local, not cross-project semantic resolution.

Missing test-file changes are not test coverage. Duplicate scores are lexical similarity, not probability; server candidates use the most recent 1,000 synchronized issues. CI diagnosis inspects at most ten failed logs in the first 100 jobs, bounded to 2 MB each. It suggests causes rather than proving them. Networked scans reuse analysis fingerprints but currently refetch remote trees/manifests; large-project incremental caching is future work.

Local health cannot know remote maintainer response/review/dependency freshness. Release prepare computes draft recommendations, never publishes tags, npm packages or GitHub releases.

## Product

Policies are edited as validated JSON in the dashboard; no visual rule builder. Plugins are local operator code, not a public marketplace or malicious-code sandbox. Only plugin analyzers auto-run; other SDK capabilities need explicit invocation. Notification channels are dashboard, console identifiers and policy-controlled GitHub comments, not email/chat delivery.

AI is optional and paid separately through an API provider. Daily reservations bound request count, not exact financial cost. Browser UI surfaces stored JSON where a richer domain-specific view is not yet implemented.

No independent audit, sustained production load test, hosted service, external users, stars, package downloads or live credentials-based test result is implied.
