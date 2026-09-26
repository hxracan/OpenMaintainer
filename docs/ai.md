# Optional AI

No API key is required for deterministic analysis, the CLI or demo. Configure OPENAI_API_KEY and an explicit OPENAI_MODEL only in the worker. Do not assume a ChatGPT subscription provides API credits.

Enable ai.enabled in the repository's approved configuration, then request advice from repository details or POST /api/repositories/:owner/:repo/ai. Run the matching deterministic analysis first.

## Workflows

- pr-explanation: stored PR findings.
- issue-classification: stored triage results.
- ci-explanation: stored redacted CI diagnostics.
- duplicate-verification: stored duplicate candidates.
- release-notes: stored prepared release, using the prepared version as subject.
- maintainer-report: stored repository profile, subject repository.

The provider contract also exposes text generation and embeddings. Embeddings require OPENAI_EMBEDDING_MODEL and are not automatically used by duplicate ranking.

## Boundaries and cost

Input is redacted and bounded to 32,000 characters. Responses request a strict JSON schema, no tools, store=false and at most 2,500 output tokens. Only explicit 429/503 responses retry, at most twice. Network ambiguity is not automatically replayed.

Each repository has a transactionally reserved limit of 100 AI requests per rolling day. Reservations include failures/unknown outcomes and a unique job ID to prevent restart replay. Provider-reported successful usage is stored; pending-or-unknown rows mean tokens may have been billed but are unknown. Monetary cost remains null rather than guessing current prices. Configure your provider account's own spending limits.

AI text is an untrusted advisory, rendered as text and never passed to the action engine. Redaction is heuristic, not DLP; private project context may still leave your instance when AI is enabled. Prompt separation reduces injection risk but cannot guarantee factuality or eliminate malicious influence.

Reference: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs). Live provider validation requires operator credentials.
