'use client';
import { useEffect, useRef, useState } from 'react';
import { api, type Item, list, record, string } from './client';

const strings = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
function EvidenceList({ items, source }: { items: Item[]; source: Item }) {
  return (
    <>
      {items.map((item) => {
        const before = item.side === 'before';
        const repository = string(before ? source.repository : source.headRepository);
        const revision = string(before ? source.base : source.head);
        const url =
          Number(item.line) > 0 && /^[\w.-]+\/[\w.-]+$/.test(repository) && /^[a-f0-9]{40}$/i.test(revision)
            ? `https://github.com/${repository}/blob/${revision}/${string(item.path).split('/').map(encodeURIComponent).join('/')}#L${Number(item.line) || 1}`
            : '';
        return (
          <div
            className="evidence"
            key={`${string(item.path)}-${string(item.side)}-${string(item.line)}-${string(item.text)}`}
          >
            <small>
              {string(item.side)} ·{' '}
              {url ? (
                <a href={url} target="_blank" rel="noreferrer">
                  {string(item.path)}:{string(item.line)}
                </a>
              ) : (
                `${string(item.path)}:${Number(item.line) > 0 ? string(item.line) : 'patch excerpt'}`
              )}
            </small>
            <pre>{string(item.text)}</pre>
          </div>
        );
      })}
    </>
  );
}
function Notes({ values }: { values: unknown }) {
  return (
    <ul className="analysis-notes">
      {strings(values).map((value) => (
        <li key={value}>{value}</li>
      ))}
    </ul>
  );
}
export function InvestigationReport({ report }: { report: Item }) {
  const source = record(report.source),
    contracts = record(report.contracts),
    regression = record(report.regression),
    ci = record(report.ci),
    release = record(report.release),
    issue = record(report.issue),
    coverage = record(report.coverage);
  return (
    <section className="investigation-report" aria-label="PR investigation report">
      <article className="panel">
        <h2>
          {source.example ? 'Example report (fictional)' : 'Investigation report'}: {string(source.title)}
        </h2>
        <p>
          {string(source.repository)} #{string(source.number)} · {string(coverage.completeVersions)}/
          {string(coverage.changedFiles)} changed files have complete versions.
        </p>
        <p>
          Comparison: {string(source.base).slice(0, 12)} → {string(source.head).slice(0, 12)} ·{' '}
          {string(source.checkedAt)}
        </p>
        <Notes values={report.limitations} />
        {strings(coverage.uninspected).length > 0 && (
          <details>
            <summary>Files without full-version inspection ({strings(coverage.uninspected).length})</summary>
            <Notes values={coverage.uninspected} />
          </details>
        )}
        <button
          type="button"
          className="secondary"
          onClick={() => {
            const url = URL.createObjectURL(
              new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' }),
            );
            const anchor = document.createElement('a');
            anchor.href = url;
            anchor.download = 'openmaintainer-investigation.json';
            anchor.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          }}
        >
          Download report JSON
        </button>
      </article>
      <article className="panel">
        <h2>1. Breaking-change review</h2>
        <Notes values={contracts.limitations} />
        {!list(contracts.changes).length && (
          <p>
            No supported contract differences found in the inspected versions. This is not a compatibility
            guarantee.
          </p>
        )}
        {list(contracts.changes).map((change) => (
          <section className="tool-section" key={string(change.id)}>
            <h3>{string(change.title)}</h3>
            <p>{string(change.reason)}</p>
            <EvidenceList items={list(change.evidence)} source={source} />
            <p>
              <strong>Next step:</strong> {string(change.migration)}
            </p>
          </section>
        ))}
      </article>
      <article className="panel">
        <h2>2. Regression-test plan</h2>
        <Notes values={regression.limitations} />
        {!list(regression.candidates).length && (
          <p>No supported changed source files to suggest tests for.</p>
        )}
        {list(regression.candidates).map((candidate) => (
          <section className="tool-section" key={string(candidate.path)}>
            <h3>{string(candidate.path)}</h3>
            <span className="badge">{string(candidate.status)}</span>
            <p>Related tests: {strings(candidate.relatedTests).join(', ') || 'none identified'}</p>
            {list(candidate.cases).map((testCase) => (
              <details key={string(testCase.title)}>
                <summary>{string(testCase.title)}</summary>
                <p>
                  <strong>Arrange:</strong> {string(testCase.arrange)}
                </p>
                <p>
                  <strong>Act:</strong> {string(testCase.act)}
                </p>
                <p>
                  <strong>Assert / review:</strong> {string(testCase.assert)}
                </p>
                <EvidenceList items={list(testCase.evidence)} source={source} />
              </details>
            ))}
          </section>
        ))}
      </article>
      <article className="panel">
        <h2>3. CI failure investigation</h2>
        {!ci.supplied ? (
          <p>No CI log supplied. Paste a redacted failure log to analyze it alongside the PR.</p>
        ) : (
          <>
            <p>{string(ci.provenance)}</p>
            {list(ci.groups).map((group) => (
              <section className="tool-section" key={string(group.category)}>
                <h3>{string(group.category)}</h3>
                <p>{string(group.diagnosis)}</p>
                {list(group.excerpts).map((excerpt) => (
                  <pre key={string(excerpt.line)}>
                    Log line {string(excerpt.line)}: {string(excerpt.text)}
                  </pre>
                ))}
              </section>
            ))}
            <h3>Connections to changed files</h3>
            {!list(ci.correlations).length && <p>No changed-file path matched the supplied log.</p>}
            {list(ci.correlations).map((match) => (
              <section className="tool-section" key={string(match.path)}>
                <h4>
                  {string(match.path)} · log line {string(match.logLine)}
                </h4>
                <pre>{string(match.excerpt)}</pre>
                <p>{string(match.basis)}</p>
                <p>{string(match.nextStep)}</p>
              </section>
            ))}
            <Notes values={ci.limitations} />
          </>
        )}
      </article>
      <article className="panel">
        <h2>4. Release-risk checklist</h2>
        <p>{string(release.recommendation)}</p>
        <p>{string(release.scope)}</p>
        <p>{string(release.ciStatus)}</p>
        {!list(release.checklist).length && (
          <p>
            No additional checklist items from the supported checks. Review other changes in the release
            separately.
          </p>
        )}
        <ul>
          {list(release.checklist).map((check) => (
            <li key={`${string(check.path)}-${string(check.basis)}`}>
              <strong>{string(check.path)}</strong>: {string(check.task)}{' '}
              <small>Evidence: {string(check.basis)}</small>
            </li>
          ))}
        </ul>
      </article>
      <article className="panel">
        <h2>5. Issue-to-code leads</h2>
        <p>{string(issue.scope)}</p>
        {!issue.supplied ? (
          <p>
            No issue description supplied. Paste a report or reproduction to find related paths and
            declarations.
          </p>
        ) : !list(issue.candidates).length ? (
          <p>
            No useful text matches found. The issue may need a stack trace, symbol name or clearer
            reproduction.
          </p>
        ) : (
          list(issue.candidates).map((candidate) => (
            <section className="tool-section" key={string(candidate.path)}>
              <h3>{string(candidate.path)}</h3>
              <Notes values={candidate.reasons} />
              <EvidenceList
                items={list(candidate.evidence).map((e) => ({ ...e, path: candidate.path, side: 'after' }))}
                source={source}
              />
              <p>{string(candidate.nextStep)}</p>
            </section>
          ))
        )}
      </article>
    </section>
  );
}

export function Investigation() {
  const [url, setUrl] = useState(''),
    [issue, setIssue] = useState(''),
    [ciLog, setCiLog] = useState('');
  const [report, setReport] = useState<Item | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function run(example: boolean) {
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    setBusy(true);
    setError('');
    setReport(null);
    try {
      const response = await api(
        example ? 'investigation-example' : 'public-investigation',
        example
          ? { signal: request.signal }
          : { method: 'POST', body: JSON.stringify({ url, issue, ciLog }), signal: request.signal },
      );
      if (!request.signal.aborted) setReport(record(response.data));
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Investigation failed');
    } finally {
      if (!request.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <article className="panel">
        <h2>Investigate a public pull request</h2>
        <p>
          Compare real base/head source, plan regression tests, connect failure logs and review release risks.
          No login or AI key required. Up to eight eligible files are inspected in full; this uses up to 24
          anonymous GitHub requests.
        </p>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void run(false);
          }}
        >
          <label htmlFor="investigate-url">Public pull request URL</label>
          <input
            id="investigate-url"
            type="url"
            required
            maxLength={250}
            placeholder="https://github.com/owner/repository/pull/123"
            disabled={busy}
            value={url}
            onChange={(e) => {
              setUrl(e.target.value);
              setReport(null);
            }}
          />
          <label htmlFor="investigate-issue">Issue description or reproduction (optional)</label>
          <textarea
            id="investigate-issue"
            rows={4}
            maxLength={50000}
            disabled={busy}
            value={issue}
            onChange={(e) => {
              setIssue(e.target.value);
              setReport(null);
            }}
          />
          <label htmlFor="investigate-ci">CI failure log (optional)</label>
          <textarea
            id="investigate-ci"
            rows={5}
            maxLength={200000}
            disabled={busy}
            value={ciLog}
            onChange={(e) => {
              setCiLog(e.target.value);
              setReport(null);
            }}
          />
          <p>
            Remove credentials and sensitive data before pasting. Text is processed by this server, not sent
            to an AI provider or saved in the database. Pattern-based redaction is not foolproof.
          </p>
          <div className="detail-actions">
            <button type="submit" disabled={busy}>
              {busy ? 'Investigating…' : 'Investigate PR'}
            </button>
            <button type="button" className="secondary" disabled={busy} onClick={() => void run(true)}>
              Try example report
            </button>
          </div>
        </form>
        {busy && <p role="status">Collecting pinned source versions and evaluating evidence…</p>}
        {error && (
          <p role="alert" className="notice error">
            {error}
          </p>
        )}
      </article>
      {report && <InvestigationReport report={report} />}
    </>
  );
}
