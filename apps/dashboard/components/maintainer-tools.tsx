'use client';
import Link from 'next/link';
import { useState } from 'react';
import { api, type Item, list, record, string } from './client';
import { JobButton } from './job-button';

export function GettingStarted({ demo }: { demo: boolean }) {
  return (
    <div className="guide-grid">
      <article className="panel">
        <span className="eyebrow">1 · EXPLORE</span>
        <h2>Get your first analysis</h2>
        <p>
          {demo
            ? 'This demo contains a fictional repository so you can explore without connecting an account.'
            : 'Open a connected repository to see its structure and maintenance findings.'}
        </p>
        <Link className="button" href={demo ? '/repositories/demo/example-library' : '/repositories'}>
          Open a repository
        </Link>
        <ol>
          <li>
            Choose <strong>Analyze repository</strong>.
          </li>
          <li>Watch the job finish, then review Maintenance findings.</li>
          <li>Open Issues or CI diagnostics to investigate a specific problem.</li>
        </ol>
      </article>
      <article className="panel">
        <span className="eyebrow">2 · CONNECT</span>
        <h2>Use your own repositories</h2>
        <p>
          An instance operator sets up PostgreSQL and a GitHub App once. Maintainers then authorize the App
          for selected repositories and sign in here.
        </p>
        <ol>
          <li>Configure the App credentials and callback/webhook URLs.</li>
          <li>Install the App on a test repository and start the API and worker.</li>
          <li>Sign in with GitHub and wait for the repository to synchronize.</li>
        </ol>
        <a
          className="button secondary"
          href="https://github.com/hxracan/OpenMaintainer/blob/main/docs/installation.md"
          target="_blank"
          rel="noreferrer"
        >
          Open installation guide ↗
        </a>
        {!demo && (
          <p>
            <a href="/api/auth/login">Sign in with GitHub</a>
          </p>
        )}
      </article>
      <article className="panel">
        <span className="eyebrow">3 · SAVE TIME</span>
        <h2>Try a rule before enabling it</h2>
        <p>
          Choose a repository in Settings, edit its policy, and use Preview rules with a sample event. The
          preview explains which conditions match and shows the proposed actions.
        </p>
        <Link className="button secondary" href="/settings">
          Open repository settings
        </Link>
        <p>
          Previews do not save policies or execute actions. Keep dry-run enabled while you review real events.
        </p>
      </article>
    </div>
  );
}

export function RulePreview({ repository, configText }: { repository: string; configText: string }) {
  const [trigger, setTrigger] = useState('pull_request.opened'),
    [facts, setFacts] = useState('{"changedFiles": 60, "firstTimeContributor": true}'),
    [result, setResult] = useState<Item | null>(null),
    [previewedInput, setPreviewedInput] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function preview() {
    setPreviewedInput(JSON.stringify([configText, facts, trigger]));
    setBusy(true);
    setError('');
    setResult(null);
    try {
      setResult(
        await api(`repositories/${repository}/automations/preview`, {
          method: 'POST',
          body: JSON.stringify({ trigger, facts: JSON.parse(facts), config: JSON.parse(configText) }),
        }),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Preview failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="tool-section" aria-label="Rule preview">
      <h3>Preview rules</h3>
      <p>Test the policy above, including unsaved edits, against an example event.</p>
      <label htmlFor="preview-event">Example event</label>
      <select
        id="preview-event"
        value={trigger}
        onChange={(e) => {
          setTrigger(e.target.value);
          setResult(null);
        }}
      >
        {[
          'pull_request.opened',
          'pull_request.synchronize',
          'pull_request.labeled',
          'issues.opened',
          'issues.edited',
          'pull_request_review.submitted',
          'workflow_run.failure',
          'workflow_run.success',
          'release.published',
          'scheduled.scan',
        ].map((t) => (
          <option key={t}>{t}</option>
        ))}
      </select>
      <label htmlFor="preview-facts">Example facts (JSON)</label>
      <textarea
        id="preview-facts"
        rows={4}
        value={facts}
        onChange={(e) => {
          setFacts(e.target.value);
          setResult(null);
        }}
      />
      <button type="button" disabled={busy} onClick={() => void preview()}>
        {busy ? 'Checking…' : 'Preview rules'}
      </button>
      {error && <p role="alert">{error}</p>}
      {result && previewedInput === JSON.stringify([configText, facts, trigger]) && (
        <div role="status">
          <p>{list(result.plans).length} matching rules. No actions were executed.</p>
          {list(result.evaluations).map((e) => (
            <div className="finding" key={string(e.ruleId)}>
              <div>
                <strong>
                  {string(e.ruleId)} · {e.matched ? 'Matches' : 'Does not match'}
                </strong>
                {e.enabled === false && <p>This rule is disabled.</p>}
                {e.expectedTrigger !== trigger && <p>Requires event {string(e.expectedTrigger)}.</p>}
                {list(e.conditions).map((c) => (
                  <p key={JSON.stringify(c.condition)}>{string(c.reason)}</p>
                ))}
              </div>
            </div>
          ))}
          {list(result.plans).map((plan) => (
            <details key={string(plan.ruleId)}>
              <summary>Proposed actions: {string(plan.ruleId)}</summary>
              <pre>{JSON.stringify(plan.actions, null, 2)}</pre>
            </details>
          ))}
        </div>
      )}
    </section>
  );
}

export function DuplicateInspector({ repository, number }: { repository: string; number: string }) {
  const [result, setResult] = useState<Item | null>(null),
    [error, setError] = useState('');
  const path = `issues/${repository}/${number}/duplicates`;
  async function load() {
    try {
      const response = await api(path);
      setResult(response.data ? record(record(response.data).result) : null);
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load candidates');
    }
  }
  return (
    <details
      onToggle={(e) => {
        if (e.currentTarget.open) void load();
      }}
    >
      <summary>Possible duplicates</summary>
      <p>Compare this issue with synchronized issues in the same repository.</p>
      <JobButton path={path} label="Find duplicate candidates" onComplete={() => void load()} />
      {error && <p role="alert">{error}</p>}
      {result ? (
        <>
          <p>{string(result.scope)}. Similarity is a suggestion for your review.</p>
          {list(result.candidates).length ? (
            <ul>
              {list(result.candidates).map((c) => (
                <li key={string(c.number)}>
                  <a
                    href={`https://github.com/${repository}/issues/${string(c.number)}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Issue #{string(c.number)} ↗
                  </a>
                  <p>Lexical similarity: {typeof c.score === 'number' ? Math.round(c.score * 100) : 0}%</p>
                  <p>{string(c.explanation)}</p>
                  {Array.isArray(c.sharedTerms) && (
                    <p>Shared terms: {c.sharedTerms.map(string).join(', ')}</p>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p>No candidates met the similarity threshold in the analyzed issues.</p>
          )}
        </>
      ) : (
        <p>No duplicate check has been saved yet.</p>
      )}
    </details>
  );
}

export function JobList({ rows, onChange }: { rows: Item[]; onChange: () => void }) {
  const [filter, setFilter] = useState('');
  const filtered = rows.filter((r) =>
    `${string(r.id)} ${string(r.kind)} ${string(r.status)} ${string(r.full_name)} ${string(r.error_code)}`
      .toLowerCase()
      .includes(filter.toLowerCase()),
  );
  return (
    <article className="panel">
      <label htmlFor="job-filter">Filter jobs on this page</label>
      <input
        id="job-filter"
        type="search"
        placeholder="Job ID, repository, type, status, or error"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {!filtered.length && <p>No jobs match this page’s filter.</p>}
      {filtered.map((job) => (
        <JobCard key={string(job.id)} job={job} onChange={onChange} />
      ))}
    </article>
  );
}
function JobCard({ job, onChange }: { job: Item; onChange: () => void }) {
  const [details, setDetails] = useState<Item | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  async function load() {
    try {
      setDetails(await api(`jobs/${string(job.id)}`));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load job');
    }
  }
  async function cancel() {
    setBusy(true);
    setError('');
    try {
      await api(`jobs/${string(job.id)}/cancel`, { method: 'POST', body: '{}' });
      onChange();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cancellation failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="job-card">
      <div className="panel-heading">
        <h3>{string(job.kind)}</h3>
        <span className={`badge ${job.status === 'dead' ? 'error' : ''}`}>{string(job.status)}</span>
      </div>
      <p>
        <Link href={`/repositories/${string(job.full_name)}`}>{string(job.full_name)}</Link> · Attempts:{' '}
        {string(job.attempts)}
      </p>
      {Boolean(job.error_code) && (
        <p>
          Error: <code>{string(job.error_code)}</code>
          {job.error_code === 'ACTION_UNKNOWN'
            ? ' — inspect GitHub and the audit log before attempting recovery.'
            : ''}
        </p>
      )}
      {job.status === 'queued' && (
        <button type="button" className="secondary" disabled={busy} onClick={() => void cancel()}>
          {busy ? 'Cancelling…' : 'Cancel queued job'}
        </button>
      )}
      {error && <p role="alert">{error}</p>}
      <details
        onToggle={(e) => {
          if (e.currentTarget.open) void load();
        }}
      >
        <summary>History and result</summary>
        <p>
          <code>{string(job.id)}</code>
        </p>
        {details && (
          <>
            <ol>
              {list(details.history).map((h) => (
                <li key={`${string(h.created_at)}:${string(h.status)}`}>
                  {string(h.status)} · {string(h.created_at)} {string(h.detail)}
                </li>
              ))}
            </ol>
            {record(details.data).result !== null && (
              <pre>{JSON.stringify(record(details.data).result, null, 2)}</pre>
            )}
          </>
        )}
      </details>
    </section>
  );
}
