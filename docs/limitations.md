# Scope and limitations

This source is an initial functional implementation, not a guarantee of production readiness, zero mistakes or OSS-program acceptance.

## Analysis

Remote trees are limited to 10,000 entries and up to 100 selected manifests. PRs are limited to 500 changed files, with complete versions for up to 80 relevant text files. The language inventory counts filenames, not lines of code. TypeScript breaking-change detection is conservative and file-local, not cross-project semantic resolution.

Missing test-file changes are not test coverage. Duplicate scores are lexical similarity, not probability; server candidates use the most recent 1,000 synchronized issues. CI diagnosis inspects at most ten failed logs in the first 100 jobs, bounded to 2 MB each. It suggests causes rather than proving them. Networked scans reuse analysis fingerprints but currently refetch remote trees/manifests; large-project incremental caching is future work.

Local health cannot know remote maintainer response/review/dependency freshness. Release prepare computes draft recommendations, never publishes tags, npm packages or GitHub releases.

## Product

The standalone **PR investigation** is separate from installed-repository background analyses. It currently accepts public PRs only; pasted issue text and CI logs are not automatically retrieved or authenticated. It inspects the first eight eligible JS/TS/config files in GitHub file-list order, up to 125 KB per version, with an explicit uninspected-file list. Maximum changed files: 200; maximum complete tree: 10,000 entries; output: 200 contract findings. Renamed paths and fork head repositories are handled; the PR merge base is compared to the pinned head.

Its contract review is syntactic, not TypeScript assignability checking. It does not resolve wildcard exports, overloads, class members or inferred return types; file exports are not proven package entrypoints. It detects changes for review, including compatible ones. Regression plans are suggestions, not measured missing coverage or runnable tests. Test association is heuristic (matching stems/direct relative imports); monorepo aliases and dynamic imports may be missed. CI matches are path correlations, not verified causes. Issue matches are lexical leads in repository paths and available changed source. Release checks cover the PR only, never approve a release and cannot infer that CI passed. Redaction may mask harmless type annotations and can miss secrets.

No benchmark yet establishes real-world precision, recall or developer time saved. Fixture tests check known cases; a live dependency PR smoke test checks transport, not detection quality. Validate on your own historical changes before relying on findings.

Policies are edited as validated JSON in the dashboard; no visual rule builder. Plugins are local operator code, not a public marketplace or malicious-code sandbox. Only plugin analyzers auto-run; other SDK capabilities need explicit invocation. Notification channels are dashboard, console identifiers and policy-controlled GitHub comments, not email/chat delivery.

AI is optional and paid separately through an API provider. Daily reservations bound request count, not exact financial cost. Browser UI surfaces stored JSON where a richer domain-specific view is not yet implemented.

No independent audit, sustained production load test, hosted service, external users, stars, package downloads or live credentials-based test result is implied.
