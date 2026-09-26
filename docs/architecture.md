# Architecture

## Boundaries

The Next.js dashboard proxies only its fixed API origin. Fastify authenticates each protected request and intersects GitHub user access with active installed repositories. PostgreSQL is the system of record and the job queue. The worker uses repository-scoped installation tokens.

```text
GitHub signed webhooks -> Fastify -> PostgreSQL deliveries + jobs (one transaction)
                                      |
                                 leased worker
                                      |
          deterministic analyzers / approved rule plans / optional advisory AI
                                      |
                           analyses + audit + action ledger
                                      |
GitHub OAuth user -> Next.js dashboard -> repository-authorized API
```

No analyzed checkout is installed, imported or executed. The GitHub client permits the GitHub API origin only. Signed job-log downloads use a narrowly allowed storage-host redirect without forwarding authorization.

## Monorepo

- `apps/api`: auth, webhook intake, scoped resources, job/configuration endpoints.
- `apps/worker`: event processing, installation sync, analysis, scheduling.
- `apps/dashboard`: responsive, client-rendered application with same-origin proxy.
- `apps/docs`: static Markdown documentation build.
- `packages/core`, `shared`, `config`: contracts, bounded primitives and validated policy.
- `packages/database`: SQL migrations, transactions, jobs and audit.
- `packages/github`, `github-app`: network adapter and verified event intake.
- Analysis packages: repository, PR, issue, CI and release engines.
- `rule-engine`, `automation-engine`: deterministic conditions and guarded actions.
- `ai`, `plugin-sdk`, `cli`: optional provider, trusted extensions and local tooling.

SQL is explicit rather than ORM-generated. This makes queue locking and lease predicates directly reviewable. Internal packages expose source to workspace tooling; service builds bundle workspace code.

## Queue guarantees

Webhooks deduplicate by delivery ID and signed payload hash. Claims use PostgreSQL FOR UPDATE SKIP LOCKED. Jobs have 60-second leases, renewed every 15 seconds; completion checks the lease token and expiry. Retry backoff is bounded. Only queued jobs can be cancelled.

External writes are not transactionally atomic with PostgreSQL. The ledger records intent before an action. A crash or failed response leaves an unknown outcome and prevents automatic replay. This trades availability for avoiding duplicate effects; it is not universal exactly-once delivery.

Hourly scheduling uses a unique repository/time bucket. Configuration is loaded from maintainer-approved database records, not auto-approved from a PR or repository file. Changed/disabled rules invalidate queued action plans.

## Data

Migrations cover installations, users, repositories, OAuth states, encrypted sessions, issues, PRs, workflow runs, releases, webhook deliveries, jobs/history, analyses, automation rules/runs, action ledger, AI reservations, notifications, plugin manifests, audit events and metrics.
