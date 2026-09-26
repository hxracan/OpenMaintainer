# Security policy

OpenMaintainer 0.1.x is an initial, unaudited implementation. Do not assume suitability for high-trust or regulated environments without your own review. Security fixes target the current main branch until a release/support policy is established.

Report vulnerabilities privately through [GitHub private vulnerability reporting](https://github.com/hxracan/OpenMaintainer/security/advisories/new) if enabled. If GitHub says reporting is unavailable, contact the repository owner through a private channel shown on their profile; do not publish exploit details or secrets in a public issue. No response-time SLA is promised.

Include affected revision, impact, a minimal synthetic reproduction and any suggested fix. Never send live access tokens or private user data.

Operators must protect PostgreSQL, TLS termination, backups and host access. Install only trusted plugins. Read [the threat model](docs/threat-model.md) and [operations](docs/operations.md) before connecting private repositories.
