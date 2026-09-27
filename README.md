# OpenMaintainer

A self-hosted maintenance workbench for GitHub repositories. Inspect repository health, understand pull requests, triage issues, diagnose CI failures, and prepare release notes—with deterministic analysis first and explicit automation policies.

**Status: 0.1.0 initial implementation.** Not independently security-audited. Real GitHub App installation, OAuth and paid AI need your credentials and staging validation. No adoption or performance claims.

![OpenMaintainer local demo dashboard](docs/assets/dashboard.png)

## Try it without credentials

Requires Node.js 24 and pnpm 11.15.1.

```sh
git clone https://github.com/hxracan/OpenMaintainer.git
cd OpenMaintainer
npm install --global pnpm@11.15.1
pnpm install --frozen-lockfile
pnpm demo
```

Open [localhost:3000](http://localhost:3000). The isolated demo uses embedded PostgreSQL under `.demo/`, fictional records, and the real API/worker. It cannot call GitHub or OpenAI. Analyze the demo repository or issue to exercise the queue. Do not expose demo ports publicly.

## What works

- Repository inventory: languages, manifests, workspaces, frameworks and missing maintenance files.
- PR review: change scope, test-file signals, security-sensitive paths and potential TypeScript/API/config/migration breaks.
- Issue triage: reproduction gaps, staleness and transparent lexical duplicate candidates.
- CI diagnosis: redacted, bounded failure excerpts with evidence-backed investigation hints.
- Releases: conventional commits, Changesets, semantic-version recommendations and draft notes. Never publishes automatically.
- GitHub App: signed webhooks, installation synchronization, scoped OAuth access, durable jobs and audit records.
- Rules: versioned YAML, deterministic conditions, dry-run plans and guarded external actions with an ambiguity ledger.
- Dashboard: live repository/PR/issue/CI views, configuration, job status, notifications, analytics and analysis history.
- Guided onboarding, draft rule previews with condition explanations, issue duplicate checks, and searchable job cards with history and queued-job cancellation.
- Optional AI: six advisory workflows, schema-validated output, usage reservations and no tool execution.
- Trusted local plugins: worker-thread timeout/crash containment, SDK and three working examples.

## CLI

```sh
pnpm cli init
pnpm cli repo scan .
pnpm cli --json repo health .
pnpm cli config validate .openmaintainer.yml
pnpm cli --repo owner/repository pr analyze 42
pnpm cli ci analyze path/to/build.log
pnpm cli release prepare --version 1.0.0 --commits examples/commits.json
```

GitHub commands require `GITHUB_TOKEN`. Local analysis never runs repository scripts. See [CLI reference](docs/cli.md).

## Connect a real repository

Follow [installation](docs/installation.md), create a least-privilege GitHub App, configure `.env`, start PostgreSQL, apply migrations, then run `pnpm dev`. [Docker Compose](compose.yml) is supplied for self-hosting behind your own TLS proxy.

Keep both the repository's `dryRun: true` and `ALLOW_AUTOMATION_WRITES=false` until you have inspected plans. Repository files cannot grant their own automation permissions; a maintainer must save an approved policy through the API/dashboard.

## Documentation

[Architecture](docs/architecture.md) · [Configuration](docs/configuration.md) · [API](docs/api.md) · [Plugins](docs/plugins.md) · [AI](docs/ai.md) · [Operations](docs/operations.md) · [Threat model](docs/threat-model.md) · [Limitations](docs/limitations.md) · [Verification](docs/verification.md)

Build the documentation site with `pnpm docs:build`; open `apps/docs/dist/index.html`.

## Development

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Tests use actual embedded PostgreSQL, deterministic fixtures, mocked external HTTP boundaries and Chromium. [Contributing](CONTRIBUTING.md) explains how to run and extend them.

MIT licensed. Maintained by [hxracan](https://github.com/hxracan). Useful contributions and real-world feedback are welcome; please do not submit sensitive repository content in public issues.
