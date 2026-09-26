# Installation

## Local demo

Use Node 24 and pnpm 11.15.1. Run `pnpm install --frozen-lockfile` then `pnpm demo`. Ports 3000 and 4000 must be free. The demo refuses NODE_ENV=production or DATABASE_URL, binds loopback and cannot make integration calls. Its fictional records are not project adoption data.

## GitHub App

Create a GitHub App in your own account. Use a private staging repository first.

- Homepage: your dashboard's HTTPS URL.
- Callback: `https://YOUR_HOST/api/auth/callback`.
- Webhook: `https://YOUR_HOST/webhooks/github` routed to the API by your reverse proxy.
- Generate a random webhook secret of at least 32 characters.
- Generate a private key. Put its PEM text in GITHUB_PRIVATE_KEY with escaped newlines.
- Record App ID, client ID and client secret.

Repository permissions: Metadata read; Contents read; Actions read; Issues read/write; Pull requests read/write. Start with Issues/PR read-only if you only need analysis. No Contents write, Administration write or organization-wide write is needed. Read-only installations cannot perform configured write actions.

Subscribe to installation/repository changes, issues and issue comments, pull requests/reviews/review comments, push, releases, workflow runs/jobs and check runs. Accepted event families without an analysis/rule mapping are retained/audited, not treated as implemented automation triggers.

Install the App only on intended repositories and authorize your own GitHub user. Repository access is checked afresh for protected API calls. Sessions expire within eight hours; sign in again rather than relying on refresh-token support.

## Development with PostgreSQL

Copy `.env.example` to `.env` and populate credentials locally. Never commit `.env`. Generate TOKEN_ENCRYPTION_KEY with the command in the example. Start PostgreSQL 16 or newer, with a database/user dedicated to this instance.

```sh
node --env-file=.env --import tsx scripts/migrate.ts
pnpm dev
```

The API listens on 4000 and dashboard on 3000. Use a TLS development tunnel only for the real GitHub webhook, never the unauthenticated demo. Deliver an installation event or redeliver it from App settings to trigger initial synchronization.

## Containers

Install Docker with Compose. Populate `.env`, including POSTGRES_PASSWORD, and set DATABASE_URL to `postgres://openmaintainer:YOUR_PASSWORD@postgres:5432/openmaintainer` (URL-encode special password characters). Set DASHBOARD_URL to the externally visible HTTPS origin.

```sh
docker compose build
docker compose up -d
```

The migration service runs before API/worker startup. Dashboard/API ports bind host loopback. Supply a reverse proxy with TLS: route /webhooks/github to port 4000 and everything else to port 3000. Restrict PostgreSQL to the private container network. This repository does not provision certificates, DNS or backups.

See [operations](operations.md) before enabling external writes.
