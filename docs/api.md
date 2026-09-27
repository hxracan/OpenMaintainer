# HTTP API

Base URL is the API service (local port 4000) or the dashboard's same-origin /api proxy. JSON only; API bodies are capped at 2 MB. All /api resources except auth/login and auth/callback require authentication.

Use the GitHub OAuth session in the browser, or Authorization: Bearer GITHUB_USER_TOKEN for scripts. The token must represent a user with access to an active installed repository. Browser mutations require Origin matching DASHBOARD_URL. Do not put tokens in URLs.

## Endpoints

| Method | Path | Purpose |
| --- | --- | --- |
| GET | /health, /ready | Process and database readiness |
| POST | /webhooks/github | Signed raw GitHub JSON intake |
| GET | /api/auth/login, /api/auth/callback | OAuth flow |
| POST | /api/auth/logout | Expire session |
| GET | /api/session | Current identity |
| GET | /api/dashboard | Scoped counts and activity |
| GET | /api/repositories | Accessible installed repositories |
| GET | /api/repositories/:owner/:repo | Profile and recent records |
| GET, PUT | /api/repositories/:owner/:repo/config | Read/approve policy |
| POST | /api/repositories/:owner/:repo/analyze | Queue scan |
| POST | /api/repositories/:owner/:repo/automations/preview | Evaluate a saved or draft policy without side effects |
| GET | /api/repositories/:owner/:repo/analyses | Analysis history |
| POST | /api/repositories/:owner/:repo/ai | Queue opt-in advisory |
| GET | /api/pull-requests, /api/issues, /api/ci | Paginated records |
| GET | /api/:resource/:owner/:repo/:number | Item and stored analysis |
| POST | /api/:resource/:owner/:repo/:number/analyze | Queue deterministic analysis |
| POST | /api/issues/:owner/:repo/:number/duplicates | Queue candidate ranking |
| GET | /api/issues/:owner/:repo/:number/duplicates | Read the latest saved candidate ranking |
| GET, POST | /api/automations | List/upsert approved rule |
| GET | /api/automation-runs | Plans, dry-run state and outcomes |
| GET | /api/jobs, /api/jobs/:id | Status/history |
| POST | /api/jobs/:id/cancel | Cancel queued job |
| POST | /api/webhooks/:id/replay | Replay retained repository delivery |
| GET | /api/releases | Stored drafts |
| POST | /api/releases/:owner/:repo/prepare | Draft from current version/fromRef |
| GET | /api/plugins, /api/notifications, /api/audit, /api/analytics | Operational views |

:resource means pull-requests, issues or ci. Generic records use limit=30 and offset=0 by default, max limit=100. Automations/plugins are bounded lists without the generic pagination contract.

Analysis responses are 202 with {jobId}. Poll GET /api/jobs/:id until succeeded, dead or cancelled. Error shape: {error:{code,message,requestId}}. Not-found and unauthorized scope lookups do not return another repository's records.

Rule preview accepts {trigger:"pull_request.opened",facts:{changedFiles:60},config:{...}}; config is optional and defaults to the approved rules. Preview requires repository read access and normal Origin checks. The response includes evaluations, condition reasons and dry-run plans; it creates no jobs or policy changes.

AI body: {workflow:"maintainer-report",subject:"repository"}. Release body: {version:"1.0.0",fromRef:"v1.0.0"}. Automation POST body: {repositoryId:123,rule:{...}}. It updates the approved rule table; full config replacement replaces all rules.

The checked-in [OpenAPI description](openapi.json) covers core routes. Source schemas and tests remain authoritative for complete response shapes.
