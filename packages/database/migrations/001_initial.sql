CREATE TABLE organizations (id bigint PRIMARY KEY, login text NOT NULL UNIQUE);
CREATE TABLE users (id bigint PRIMARY KEY, login text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE installations (id bigint PRIMARY KEY, account text NOT NULL, suspended boolean NOT NULL DEFAULT false, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE repositories (
 id bigint PRIMARY KEY, installation_id bigint NOT NULL REFERENCES installations(id) ON DELETE CASCADE,
 full_name text NOT NULL UNIQUE, default_branch text NOT NULL DEFAULT 'main',
 private boolean NOT NULL DEFAULT false, archived boolean NOT NULL DEFAULT false,
 snapshot jsonb NOT NULL DEFAULT '{}', profile jsonb, config jsonb,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE sessions (id_hash text PRIMARY KEY, user_id bigint NOT NULL REFERENCES users(id) ON DELETE CASCADE, token_cipher text NOT NULL, expires_at timestamptz NOT NULL);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE oauth_states (state_hash text PRIMARY KEY, expires_at timestamptz NOT NULL);
CREATE TABLE issues (repository_id bigint NOT NULL REFERENCES repositories(id) ON DELETE CASCADE, number integer NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(repository_id,number));
CREATE TABLE pull_requests (repository_id bigint NOT NULL REFERENCES repositories(id) ON DELETE CASCADE, number integer NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(repository_id,number));
CREATE TABLE workflow_runs (repository_id bigint NOT NULL REFERENCES repositories(id) ON DELETE CASCADE, id bigint NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(repository_id,id));
CREATE TABLE releases (repository_id bigint NOT NULL REFERENCES repositories(id) ON DELETE CASCADE, version text NOT NULL, data jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(repository_id,version));
CREATE TABLE webhook_deliveries (id text PRIMARY KEY, event text NOT NULL, repository_id bigint, installation_id bigint, payload jsonb, payload_hash text NOT NULL UNIQUE, status text NOT NULL DEFAULT 'queued', received_at timestamptz NOT NULL DEFAULT now(), processed_at timestamptz);
CREATE INDEX deliveries_received ON webhook_deliveries(received_at);
CREATE TABLE jobs (
 id text PRIMARY KEY, kind text NOT NULL, repository_id bigint REFERENCES repositories(id) ON DELETE CASCADE,
 payload jsonb NOT NULL, status text NOT NULL DEFAULT 'queued' CHECK(status IN('queued','running','succeeded','dead','cancelled')),
 attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5,
 available_at timestamptz NOT NULL DEFAULT now(), lease_until timestamptz, lease_token text,
 dedupe_key text UNIQUE, error_code text, result jsonb, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX jobs_claim ON jobs(status,available_at);
CREATE INDEX jobs_repository ON jobs(repository_id,created_at);
CREATE TABLE job_history (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job_id text NOT NULL REFERENCES jobs(id) ON DELETE CASCADE, status text NOT NULL, detail text, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE analyses (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, repository_id bigint NOT NULL REFERENCES repositories(id) ON DELETE CASCADE, kind text NOT NULL, subject text NOT NULL, fingerprint text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(repository_id,kind,subject,fingerprint));
CREATE INDEX analyses_latest ON analyses(repository_id,kind,subject,created_at DESC);
CREATE TABLE automation_rules (repository_id bigint NOT NULL REFERENCES repositories(id) ON DELETE CASCADE, id text NOT NULL, rule jsonb NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(repository_id,id));
CREATE TABLE automation_runs (id text PRIMARY KEY, repository_id bigint NOT NULL REFERENCES repositories(id) ON DELETE CASCADE, event_id text NOT NULL, rule_id text NOT NULL, plan jsonb NOT NULL, dry_run boolean NOT NULL, status text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(repository_id,event_id,rule_id));
CREATE TABLE action_ledger (id text PRIMARY KEY, run_id text NOT NULL REFERENCES automation_runs(id) ON DELETE CASCADE, status text NOT NULL CHECK(status IN('pending','started','succeeded','unknown','failed')), result jsonb, updated_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE ai_usage (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, repository_id bigint NOT NULL REFERENCES repositories(id) ON DELETE CASCADE, model text NOT NULL, input_tokens integer NOT NULL, output_tokens integer NOT NULL, estimated_cost numeric, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE notifications (id text PRIMARY KEY, repository_id bigint NOT NULL REFERENCES repositories(id) ON DELETE CASCADE, channel text NOT NULL, message text NOT NULL, read_at timestamptz, created_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE plugins (name text PRIMARY KEY, version text NOT NULL, enabled boolean NOT NULL DEFAULT false, manifest jsonb NOT NULL);
CREATE TABLE audit_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, actor text NOT NULL, repository_id bigint, action text NOT NULL, result text NOT NULL, created_at timestamptz NOT NULL DEFAULT now());
CREATE INDEX audit_repository_time ON audit_events(repository_id,created_at DESC);
CREATE TABLE metrics (name text NOT NULL, bucket timestamptz NOT NULL DEFAULT date_trunc('hour',now()), value double precision NOT NULL, count bigint NOT NULL DEFAULT 1, PRIMARY KEY(name,bucket));
