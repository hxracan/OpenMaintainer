# Implementation plan

OpenMaintainer 0.1.0 is an initial release, not a claim of audited production readiness.

1. Foundation: strict TypeScript workspaces, domain contracts, PostgreSQL migrations, GitHub client and CLI.
2. Analysis: static repository profiles, PR risk, issue triage, duplicate ranking and fixtures.
3. Policies: versioned configuration, pure rule evaluation, automation plans, CI diagnosis and release preparation.
4. Services: authenticated API, signed webhooks, transactional queue, retries, lease recovery and audit trail.
5. Dashboard: GitHub OAuth, repository-scoped access, live API views and isolated local demo.
6. AI: provider contracts, bounded structured responses, advisory workflows and security tests.
7. Extensions: explicit plugin registration, fault containment, notifications and operational metrics.
8. Delivery: documentation, deployment, complete checks and review.

Each phase must pass lint, typecheck, tests and build before continuing. Verification is recorded in docs/verification.md. No user counts or adoption claims are generated.

## Decisions

Use PostgreSQL for both domain storage and a durable transactional queue. INSERTing a webhook and its first job in the same transaction avoids a database/Redis dual-write failure. Workers claim jobs with SKIP LOCKED and renew leases. External POST actions use a persistent execution ledger; ambiguous outcomes require manual reconciliation rather than blind retries.

Internal packages expose TypeScript to workspace tooling; service and CLI builds bundle workspace code into Node ESM artifacts. Next.js transpiles internal packages. Static analysis never executes repository code. API and worker are independent processes. Demo mode uses a separate embedded PostgreSQL database and cannot call external action executors.
