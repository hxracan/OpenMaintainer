# Operations

## Before connecting private repositories

Use TLS, strong independent secrets, a dedicated PostgreSQL account, encrypted backups and host access controls. Keep the worker's App private key separate from dashboard configuration. Run service processes as non-root. Do not log request headers, OAuth codes, raw payloads or raw CI logs.

Apply migrations explicitly before starting new workers. Migrations are ordered SQL files under packages/database/migrations, serialized by a schema table lock and applied transactionally. Only simple SQL statements are supported; do not place procedural bodies or quoted semicolons in migration files.

## Health and logs

API GET /health verifies the process; /ready checks database connectivity. Worker startup fails on invalid configuration. Pino logs job IDs, repository IDs, durations and error codes, not source content. The metrics table aggregates worker durations by job kind and hour. /api/analytics exposes only repository-scoped counts and AI usage; aggregate host metrics are not exposed to ordinary users.

Workers process one job at a time per process; run additional identical workers for concurrency. PostgreSQL leases coordinate ownership. Rate limiting is per API process; configure a shared edge limit when horizontally scaling.

## Failures

Queued jobs retry with bounded exponential delays, up to five attempts. Inspect /api/jobs or dashboard Jobs. Queued work can be cancelled. Automatic retries do not apply to known invalid input or ambiguous external actions.

For ACTION_UNKNOWN, inspect the action ledger, audit trail and GitHub state. Comment markers identify an action key. Do not simply clear the ledger or replay a non-idempotent action. There is no reconciliation UI in this version; an operator must investigate and make an explicit recovery decision.

AI pending-or-unknown reservations likewise require inspection rather than replay. They reserve request budget even when the provider may not have received a request.

## Retention

The hourly scheduler clears processed webhook payloads after seven days; successful/cancelled jobs and history after 30 days; analyses after 90 days; audit records after 180 days. Expired sessions/OAuth states are removed. Failed/ignored webhook payloads, dead jobs, action ledger, AI usage and domain data are retained until an operator's retention process handles them. Plan storage and privacy requirements accordingly.

Uninstall synchronization deletes the installation and cascaded repository data. Audit metadata without foreign keys remains until retention. Backups may retain older data: define your own deletion/backup policy.

## Backups and upgrades

Back up PostgreSQL and the encryption key separately with restricted access. Losing the key makes existing session tokens unreadable; rotate it by expiring all sessions and requiring login again. Test restoration in staging. This project does not ship automated backups or destructive reset commands.

Shut down services cleanly with SIGTERM. Long jobs may complete during shutdown; killed workers recover through lease expiration. Do not expose demo mode or its database to production.
