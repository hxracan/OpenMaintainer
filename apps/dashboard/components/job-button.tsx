'use client';
import { useEffect, useRef, useState } from 'react';
import { api, record, string } from './client';
export function JobButton({
  path,
  label,
  onComplete,
  body = {},
  disabled = false,
}: {
  path: string;
  label: string;
  onComplete?: () => void;
  body?: unknown;
  disabled?: boolean;
}) {
  const [state, setState] = useState(''),
    [busy, setBusy] = useState(false);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  async function run() {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setState('Queueing…');
    try {
      const response = await api(path, {
          method: 'POST',
          body: JSON.stringify(body),
          signal: controller.signal,
        }),
        id = string(response.jobId);
      setState('Queued');
      for (let attempt = 0; attempt < 120; attempt++) {
        await new Promise((r) => setTimeout(r, 1000));
        if (controller.signal.aborted) return;
        const job = record((await api(`jobs/${id}`, { signal: controller.signal })).data);
        setState(string(job.status));
        if (['succeeded', 'dead', 'cancelled'].includes(string(job.status))) {
          if (job.status === 'succeeded') onComplete?.();
          else setState(string(job.error_code) || string(job.status));
          return;
        }
      }
      setState('Still running. Refresh to see results.');
    } catch (e) {
      if (!controller.signal.aborted) setState(e instanceof Error ? e.message : 'Analysis failed');
    } finally {
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <span className="job-control">
      <button type="button" disabled={busy || disabled} onClick={() => void run()}>
        {busy ? 'Working…' : label}
      </button>
      <span role="status">{state}</span>
    </span>
  );
}
