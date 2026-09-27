'use client';
import { useState } from 'react';
import { api, type Item, list, string } from './client';

export function RepositoryChecker() {
  const [repository, setRepository] = useState('');
  const [report, setReport] = useState<Item | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  return (
    <article className="panel">
      <h2>Check a public GitHub repository</h2>
      <p>
        No sign-in or GitHub App installation needed. This makes read-only requests to GitHub, including in
        demo mode.
      </p>
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError('');
          setReport(null);
          try {
            const response = await api('public-scan', {
              method: 'POST',
              body: JSON.stringify({ repository }),
            });
            setReport(response.data as Item);
          } catch (e) {
            setError(e instanceof Error ? e.message : 'Check failed');
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="public-repository">GitHub repository URL or owner/repository</label>
        <input
          id="public-repository"
          value={repository}
          onChange={(event) => {
            setRepository(event.target.value);
            setReport(null);
          }}
          placeholder="https://github.com/owner/repository"
          required
          maxLength={250}
          disabled={busy}
        />
        <button type="submit" disabled={busy}>
          {busy ? 'Checking repository…' : 'Check repository'}
        </button>
      </form>
      {busy && <p role="status">Reading the default-branch file tree from GitHub…</p>}
      {error && (
        <p role="alert" className="notice error">
          {error}
        </p>
      )}
      {report && (
        <section aria-label="Repository check report" aria-live="polite">
          <h2>Report: {string(report.repository)}</h2>
          <p>
            Branch: {string(report.branch)} · {string(report.fileCount)} files ·{' '}
            {Array.isArray(report.languages) ? report.languages.join(', ') : ''}
          </p>
          {report.archived === true && (
            <p className="notice">This repository is archived and may no longer be maintained.</p>
          )}
          <ul>
            {list(report.checks).map((check) => (
              <li key={string(check.id)}>
                {string(check.id)}: {check.present ? 'Found' : 'Missing'}
              </li>
            ))}
          </ul>
          <h3>Suggested improvements</h3>
          {list(report.findings).length === 0 ? (
            <p>
              No missing files detected by these six checks. This does not mean the code is bug-free or
              secure.
            </p>
          ) : (
            list(report.findings).map((finding) => (
              <div className="tool-section" key={string(finding.ruleId)}>
                <h4>{string(finding.title)}</h4>
                <p>{string(finding.explanation)}</p>
              </div>
            ))
          )}
          <p>{string(report.scope)}</p>
          <small>
            Checked {string(report.checkedAt)} · Tree {string(report.treeSha)}
          </small>
        </section>
      )}
    </article>
  );
}
