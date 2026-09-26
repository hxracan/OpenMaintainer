# Contributor instructions

Use Node 24 and pnpm. Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build` after meaningful changes. Run `pnpm test:e2e` for dashboard changes. Keep deterministic engines independent of I/O. Never execute analyzed repository scripts. Never weaken authorization, signature verification, input bounds or the external-action ledger to pass tests. Keep credentials out of logs, fixtures and commits. Document actual limitations and verification. Keep demo data isolated from production.
