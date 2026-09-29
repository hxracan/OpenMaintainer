'use client';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';

import { api, type Item, list, record, string } from './client';
import { Investigation } from './investigation';
import { JobButton } from './job-button';
import { DuplicateInspector, GettingStarted, JobList, RulePreview } from './maintainer-tools';
import { RepositoryChecker } from './repository-checker';

const sections = [
  ['getting-started', 'Getting started', '→'],
  ['repository-checker', 'Repository checker', '⌕'],
  ['investigation', 'PR investigation', '⌘'],
  ['dashboard', 'Overview', '◈'],
  ['repositories', 'Repositories', '▣'],
  ['pull-requests', 'Pull requests', '⑂'],
  ['issues', 'Issues', '◉'],
  ['ci', 'CI diagnostics', '▥'],
  ['releases', 'Releases', '↗'],
  ['automations', 'Automations', '◇'],
  ['plugins', 'Plugins', '⊞'],
  ['analytics', 'Analytics', '▤'],
  ['notifications', 'Notifications', '◌'],
  ['jobs', 'Jobs', '↻'],
  ['audit-log', 'Audit log', '≡'],
  ['settings', 'Settings', '⚙'],
] as const;
const descriptions: Record<string, string> = {
  investigation: 'Evidence, regression scenarios and release risks from a real change set.',
  'repository-checker': 'Paste a public repository URL to find maintenance gaps.',
  'getting-started': 'Your first useful result, and how to connect your own repositories.',
  dashboard: 'A clear view of the work that needs your attention.',
  repositories: 'Repository structure, maintenance signals, and analysis.',
  'pull-requests': 'Understand change scope before you start a review.',
  issues: 'Reproduction gaps, triage suggestions, and possible duplicates.',
  ci: 'Find useful evidence in failing workflow runs.',
  releases: 'Prepare a version and changelog for human review.',
  automations: 'Explicit rules. Traceable actions. Dry-run by default.',
  plugins: 'Extensions registered by your instance operator.',
  analytics: 'Recorded job outcomes and provider-reported token usage.',
  notifications: 'Policy-generated maintenance notifications.',
  jobs: 'Background work, retries, and failures that need attention.',
  'audit-log': 'A record of maintenance decisions and actions.',
  settings: 'Manage repository policy and your session.',
};
export function Workspace({ segments }: { segments: string[] }) {
  const section = segments[0] ?? 'dashboard',
    detail = section === 'repositories' && segments.length === 3;
  const [session, setSession] = useState<Item>({}),
    [data, setData] = useState<Item>({}),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0),
    [offset, setOffset] = useState(0);
  const title = detail
    ? segments.slice(1).join('/')
    : (sections.find((s) => s[0] === section)?.[1] ?? 'Page not found');
  const endpoint = detail
    ? `repositories/${segments.slice(1).map(encodeURIComponent).join('/')}`
    : section === 'audit-log'
      ? 'audit'
      : section === 'settings'
        ? 'repositories'
        : section;
  const reload = useCallback(() => setRefresh((n) => n + 1), []);
  // Each navigation has its own abort flag so a slow previous page cannot overwrite the current one.
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    if (['getting-started', 'repository-checker', 'investigation'].includes(section)) {
      setLoading(false);
      void api('session')
        .then((s) => {
          if (active) setSession(s);
        })
        .catch(() => {});
      return () => {
        active = false;
      };
    }
    Promise.all([api('session'), api(`${endpoint}?limit=30&offset=${offset}&refresh=${refresh}`)])
      .then(([s, d]) => {
        if (active) {
          setSession(s);
          setData(d);
        }
      })
      .catch((e) => {
        if (active) setError(e instanceof Error ? e.message : 'Request failed');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [endpoint, offset, refresh, section]);
  const rows = list(data.data),
    repo = record(data.data),
    counts = record(data.data),
    demo = session.mode === 'demo';
  return (
    <div className="shell">
      <aside className="sidebar">
        <Link className="brand" href="/dashboard">
          <span className="brand-mark">om</span>
          <span>
            OpenMaintainer<small>MAINTENANCE WORKSPACE</small>
          </span>
        </Link>
        <div className="nav-label">WORKSPACE</div>
        <nav aria-label="Main navigation">
          {sections.map(([path, label, icon]) => (
            <Link
              key={path}
              className={section === path ? 'active' : ''}
              href={`/${path}`}
              onClick={() => setOffset(0)}
            >
              <span aria-hidden="true">{icon}</span>
              {label}
            </Link>
          ))}
        </nav>
        <div className="sidebar-footer">
          <span className="status-dot" />
          {demo ? 'Local demo instance' : 'Self-hosted instance'}
          <small>Human decisions. Less repetitive work.</small>
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <span className="separator">/</span> {title}
          </span>
          <span className="user">
            <span className="avatar">
              {string(record(session.user).login).slice(0, 1).toUpperCase() || '?'}
            </span>
            {string(record(session.user).login) || 'Not signed in'}
          </span>
        </header>
        {demo && (
          <div className="demo-banner">
            DEMO · Seeded fictional repositories · GitHub writes and AI calls are disabled
          </div>
        )}
        <section className="content">
          <div className="page-heading">
            <div>
              <div className="eyebrow">MAINTAIN WITH CONFIDENCE</div>
              <h1>{title}</h1>
              <p>{descriptions[section]}</p>
            </div>
            <button type="button" className="secondary" onClick={reload}>
              ↻ Refresh
            </button>
          </div>
          {error ? (
            <div className="notice error" role="alert">
              <strong>{error}</strong>
              <p>Check your session or API connection and try again.</p>
              <a className="button" href="/api/auth/login">
                Sign in with GitHub
              </a>
            </div>
          ) : loading ? (
            <div className="loading" role="status">
              Loading your workspace…
            </div>
          ) : (
            <>
              {section === 'investigation' ? (
                <Investigation />
              ) : section === 'repository-checker' ? (
                <RepositoryChecker />
              ) : section === 'getting-started' ? (
                <GettingStarted demo={demo} />
              ) : section === 'jobs' ? (
                <JobList rows={rows} onChange={reload} />
              ) : section === 'dashboard' ? (
                <>
                  <div className="metrics">
                    {[
                      ['Repositories', 'repositories'],
                      ['Open pull requests', 'pull_requests'],
                      ['Open issues', 'issues'],
                      ['Failing runs', 'failing_runs'],
                    ].map(([label, key]) => (
                      <div className="metric" key={key}>
                        <span>{label}</span>
                        <strong>{string(counts[key ?? '']) || '0'}</strong>
                        <small>
                          {label === 'Failing runs'
                            ? 'From synchronized workflow history'
                            : 'Within your repository access'}
                        </small>
                      </div>
                    ))}
                  </div>
                  <div className="two-column">
                    <article className="panel">
                      <div className="panel-heading">
                        <h2>Recent activity</h2>
                        <Link href="/audit-log">View audit log →</Link>
                      </div>
                      <Activity rows={list(data.activity).slice(0, 6)} />
                    </article>
                    <article className="panel accent">
                      <span className="eyebrow">YOUR REVIEW, YOUR CALL</span>
                      <h2>Automation you can inspect.</h2>
                      <p>
                        Start with dry-run policies, review the planned actions, then choose which repository
                        workflows to enable.
                      </p>
                      <Link className="button" href="/automations">
                        Review automations →
                      </Link>
                      <div className="small-stat">
                        <strong>{string(counts.failed_jobs) || '0'}</strong> jobs need attention
                      </div>
                    </article>
                  </div>
                </>
              ) : detail ? (
                <>
                  <div className="detail-actions">
                    <JobButton
                      path={`repositories/${segments.slice(1).join('/')}/analyze`}
                      label="Analyze repository"
                      onComplete={reload}
                    />
                    <span className="badge">Default branch: {string(repo.default_branch)}</span>
                  </div>
                  <RepositoryProfile profile={record(repo.profile)} />
                  <RepositoryTools name={string(repo.full_name)} demo={demo} />
                  {Array.isArray(repo.recentPullRequests) && (
                    <RecordTable rows={list(repo.recentPullRequests)} section="pull-requests" />
                  )}
                </>
              ) : section === 'analytics' ? (
                <article className="panel">
                  <h2>Recorded activity</h2>
                  <p>
                    Counts describe this instance, not project adoption. Unknown AI usage has no estimated
                    token count.
                  </p>
                  <pre>{JSON.stringify(data, null, 2)}</pre>
                </article>
              ) : section === 'repositories' ? (
                <div className="repo-grid">
                  {rows.length ? (
                    rows.map((r) => (
                      <Link
                        className="repo-card"
                        key={string(r.id)}
                        href={`/repositories/${string(r.full_name)}`}
                      >
                        <div className="card-top">
                          <span className="repo-icon">▣</span>
                          <span className="badge">{r.private ? 'Private' : 'Public'}</span>
                        </div>
                        <h2>{string(r.full_name)}</h2>
                        <p>
                          {Object.keys(record(record(r.profile).languages)).join(' · ') ||
                            'Awaiting repository analysis'}
                        </p>
                        <div className="card-bottom">
                          <span>{list(record(r.profile).findings).length} maintenance findings</span>
                          <span>Open →</span>
                        </div>
                      </Link>
                    ))
                  ) : (
                    <Empty
                      title="No repositories synchronized"
                      text="Install the GitHub App and allow the initial repository scan to finish. Only repositories you can access appear here."
                    />
                  )}
                </div>
              ) : section === 'settings' ? (
                <Settings repositories={rows} />
              ) : section === 'automations' ? (
                <>
                  <div className="notice">
                    Rules are configured under Settings for each repository. A dry-run plan records intended
                    actions without making GitHub changes.
                  </div>
                  <RecordTable rows={rows} section={section} />
                </>
              ) : section === 'audit-log' ? (
                <article className="panel">
                  <Activity rows={rows} />
                </article>
              ) : (
                <RecordTable rows={rows} section={section} />
              )}
              {!detail &&
                ![
                  'dashboard',
                  'settings',
                  'getting-started',
                  'repository-checker',
                  'investigation',
                  'analytics',
                  'plugins',
                  'automations',
                ].includes(section) && (
                  <div className="pagination">
                    <button
                      type="button"
                      disabled={offset === 0}
                      onClick={() => setOffset(Math.max(0, offset - 30))}
                    >
                      ← Previous
                    </button>
                    <span>
                      {rows.length
                        ? `Showing ${offset + 1}–${offset + rows.length}`
                        : 'No records on this page'}
                    </span>
                    <button type="button" disabled={rows.length < 30} onClick={() => setOffset(offset + 30)}>
                      Next →
                    </button>
                  </div>
                )}
            </>
          )}
        </section>
        <footer className="page-footer">
          OpenMaintainer · Deterministic analysis first. Every action accountable.
        </footer>
      </main>
    </div>
  );
}
function Empty({ title, text }: { title: string; text: string }) {
  return (
    <div className="empty">
      <span aria-hidden="true">◇</span>
      <h2>{title}</h2>
      <p>{text}</p>
    </div>
  );
}
function Activity({ rows }: { rows: Item[] }) {
  return rows.length ? (
    <ol className="activity">
      {rows.map((r, i) => (
        <li key={string(r.id) || string(r.created_at) + i}>
          <span className="activity-dot" />
          <div>
            <strong>{string(r.action).replaceAll('.', ' · ')}</strong>
            <p>{string(r.result)}</p>
          </div>
          <time>{new Date(string(r.created_at)).toLocaleString()}</time>
        </li>
      ))}
    </ol>
  ) : (
    <Empty
      title="No activity yet"
      text="Analysis, configuration changes, and automation actions will appear here."
    />
  );
}
function RepositoryProfile({ profile }: { profile: Item }) {
  const findings = list(profile.findings);
  if (!Object.keys(profile).length)
    return (
      <Empty
        title="Ready for an initial scan"
        text="Analyze this repository to discover its structure and maintenance files."
      />
    );
  return (
    <>
      <div className="metrics">
        {[
          ['Languages', Object.keys(record(profile.languages)).join(', ')],
          ['Package managers', ((profile.packageManagers as string[]) ?? []).join(', ')],
          ['Test frameworks', ((profile.testFrameworks as string[]) ?? []).join(', ')],
        ].map(([label, value]) => (
          <div className="metric text-metric" key={label}>
            <span>{label}</span>
            <strong>{value || 'Not detected'}</strong>
          </div>
        ))}
      </div>
      <article className="panel">
        <h2>Maintenance findings</h2>
        {findings.length ? (
          findings.map((f) => (
            <div className="finding" key={string(f.ruleId) + string(f.path)}>
              <span className={`badge ${string(f.severity)}`}>{string(f.severity)}</span>
              <div>
                <h3>{string(f.title)}</h3>
                <p>{string(f.explanation)}</p>
                {Boolean(f.path) && <code>{string(f.path)}</code>}
              </div>
            </div>
          ))
        ) : (
          <p>No findings from the current deterministic rules.</p>
        )}
      </article>
    </>
  );
}
function RecordTable({ rows, section }: { rows: Item[]; section: string }) {
  if (!rows.length)
    return (
      <Empty
        title={`No ${section === 'ci' ? 'workflow runs' : section.replaceAll('-', ' ')} yet`}
        text="Records appear after repository synchronization and analysis. Nothing is invented to fill this view."
      />
    );
  return (
    <div className="panel table-wrap">
      <table>
        <thead>
          <tr>
            <th>{section === 'plugins' ? 'Extension' : 'Item'}</th>
            <th>Repository</th>
            <th>Status</th>
            <th>Details</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = record(r.data),
              rule = record(r.rule),
              manifest = record(r.manifest),
              title =
                string(d.title) ||
                string(d.name) ||
                string(r.id) ||
                string(r.name) ||
                string(r.version) ||
                'Record',
              number = string(r.number || r.id);
            return (
              <tr key={`${string(r.repository_id)}:${number || string(r.name) || string(r.version)}`}>
                <td>
                  <strong>{title}</strong>
                  <small>{string(d.head_branch) || string(rule.when) || string(manifest.description)}</small>
                </td>
                <td>{string(r.full_name) || 'Instance extension'}</td>
                <td>
                  <span className={`badge ${d.conclusion === 'failure' ? 'error' : ''}`}>
                    {string(d.conclusion) ||
                      string(d.state) ||
                      string(r.status) ||
                      (r.enabled === false ? 'Disabled' : 'Configured')}
                  </span>
                </td>
                <td>
                  {['pull-requests', 'issues', 'ci'].includes(section) && (
                    <AnalysisInspector path={`${section}/${string(r.full_name)}/${number}`} />
                  )}
                  {section === 'issues' && (
                    <DuplicateInspector repository={string(r.full_name)} number={number} />
                  )}
                  <details>
                    <summary>Inspect record</summary>
                    <pre>{JSON.stringify(d.title || d.name ? d : r, null, 2)}</pre>
                  </details>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
function AnalysisInspector({ path }: { path: string }) {
  const [result, setResult] = useState<Item>({}),
    [error, setError] = useState('');
  async function load() {
    try {
      const response = await api(path);
      setResult(record(list(response.analyses)[0]?.result));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load analysis');
    }
  }
  return (
    <>
      <JobButton path={`${path}/analyze`} label="Analyze" onComplete={() => void load()} />
      <details
        onToggle={(e) => {
          if (e.currentTarget.open) void load();
        }}
      >
        <summary>View analysis</summary>
        {error ? (
          <p role="alert">{error}</p>
        ) : Object.keys(result).length ? (
          <>
            <p>{string(result.risk) ? `Review risk: ${string(result.risk)}` : 'Latest stored analysis'}</p>
            {list(result.findings).map((f) => (
              <div className="finding" key={string(f.ruleId) + string(f.path)}>
                <div>
                  <strong>{string(f.title)}</strong>
                  <p>{string(f.explanation)}</p>
                </div>
              </div>
            ))}
            <pre>{JSON.stringify(result, null, 2)}</pre>
          </>
        ) : (
          <p>No stored analysis yet. Run Analyze to create one.</p>
        )}
      </details>
    </>
  );
}
function RepositoryTools({ name, demo }: { name: string; demo: boolean }) {
  const [workflow, setWorkflow] = useState('maintainer-report'),
    [subject, setSubject] = useState('repository'),
    [version, setVersion] = useState(''),
    [fromRef, setFromRef] = useState(''),
    [history, setHistory] = useState<Item[]>([]),
    [error, setError] = useState('');
  async function load() {
    try {
      setHistory(list((await api(`repositories/${name}/analyses`)).data));
      setError('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Cannot load analyses');
    }
  }
  return (
    <article className="panel settings">
      <h2>Maintainer tools</h2>
      <details>
        <summary>Prepare release notes</summary>
        <p>Creates a local draft only. No GitHub release or tag is published.</p>
        <label htmlFor="release-version">Current version</label>
        <input
          id="release-version"
          value={version}
          placeholder="1.0.0"
          onChange={(e) => setVersion(e.target.value)}
        />
        <label htmlFor="release-ref">Compare from tag or commit</label>
        <input
          id="release-ref"
          value={fromRef}
          placeholder="v1.0.0"
          onChange={(e) => setFromRef(e.target.value)}
        />
        <JobButton
          label="Prepare draft"
          path={`releases/${name}/prepare`}
          body={{ version, fromRef }}
          disabled={demo || !version || !fromRef}
          onComplete={() => void load()}
        />
        {demo && <p>GitHub comparison requires a connected production instance.</p>}
      </details>
      <details>
        <summary>Optional AI advice</summary>
        <p>
          Requires operator credentials and repository AI opt-in. Sends stored analysis to the configured
          provider; cannot execute actions.
        </p>
        <label htmlFor="ai-workflow">Workflow</label>
        <select id="ai-workflow" value={workflow} onChange={(e) => setWorkflow(e.target.value)}>
          {[
            'maintainer-report',
            'pr-explanation',
            'issue-classification',
            'ci-explanation',
            'duplicate-verification',
            'release-notes',
          ].map((w) => (
            <option key={w}>{w}</option>
          ))}
        </select>
        <label htmlFor="ai-subject">Subject (repository, PR/issue/run number, or prepared version)</label>
        <input id="ai-subject" value={subject} onChange={(e) => setSubject(e.target.value)} />
        <JobButton
          label="Request advice"
          path={`repositories/${name}/ai`}
          body={{ workflow, subject }}
          disabled={demo || !subject}
          onComplete={() => void load()}
        />
      </details>
      <details
        onToggle={(e) => {
          if (e.currentTarget.open) void load();
        }}
      >
        <summary>Analysis history (including plugins and AI)</summary>
        {error && <p role="alert">{error}</p>}
        {history.map((a) => (
          <details key={string(a.id)}>
            <summary>
              {string(a.kind)} · {string(a.subject)}
            </summary>
            <pre>{JSON.stringify(a.result, null, 2)}</pre>
          </details>
        ))}
        {!history.length && <p>No recorded analyses.</p>}
      </details>
    </article>
  );
}
function Settings({ repositories }: { repositories: Item[] }) {
  const loadSequence = useRef(0);
  const [selected, setSelected] = useState(''),
    [content, setContent] = useState(''),
    [status, setStatus] = useState('');
  async function load(name: string) {
    const sequence = ++loadSequence.current;
    setSelected(name);
    setContent('');
    setStatus('');
    if (!name) {
      setContent('');
      return;
    }
    try {
      const response = await api(`repositories/${name}/config`);
      if (sequence === loadSequence.current) setContent(JSON.stringify(response.data, null, 2));
    } catch (e) {
      if (sequence === loadSequence.current)
        setStatus(e instanceof Error ? e.message : 'Could not load policy');
    }
  }
  async function save() {
    try {
      JSON.parse(content);
      await api(`repositories/${selected}/config`, { method: 'PUT', body: content });
      setStatus('Policy saved. New events use this configuration.');
    } catch (e) {
      setStatus(e instanceof Error ? e.message : 'Save failed');
    }
  }
  return (
    <article className="panel settings">
      <h2>Repository policy</h2>
      <p>
        Policies require GitHub write access. Keep dryRun enabled until you have inspected the planned
        actions.
      </p>
      <label htmlFor="repository">Repository</label>
      <select id="repository" value={selected} onChange={(e) => void load(e.target.value)}>
        <option value="">Choose a repository</option>
        {repositories.map((r) => (
          <option key={string(r.id)} value={string(r.full_name)}>
            {string(r.full_name)}
          </option>
        ))}
      </select>
      {selected && (
        <>
          <label htmlFor="configuration">Configuration (JSON)</label>
          <textarea
            id="configuration"
            rows={18}
            spellCheck={false}
            value={content}
            onChange={(e) => setContent(e.target.value)}
          />
          <button type="button" onClick={() => void save()}>
            Save policy
          </button>
          <RulePreview key={selected} repository={selected} configText={content} />
        </>
      )}
      <p role="status">{status}</p>
      <hr />
      <h2>Session</h2>
      <button
        type="button"
        className="secondary"
        onClick={() => {
          void api('auth/logout', { method: 'POST', body: '{}' })
            .then(() => {
              window.location.href = '/dashboard';
            })
            .catch((e) => setStatus(e.message));
        }}
      >
        Sign out
      </button>
    </article>
  );
}
