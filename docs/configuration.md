# Configuration

The CLI validates `.openmaintainer.yml`. Server policy is explicitly approved via Settings (JSON) or PUT /api/repositories/:owner/:repo/config. Finding a config in a remote tree does not authorize it.

In Settings, select a repository and use **Preview rules** below the policy editor. Choose an example event and enter its facts as JSON. The preview uses your current draft, explains matching and non-matching conditions, and lists proposed actions. It never saves the policy, queues work, or performs actions, even when the draft has dryRun=false.

```yaml
version: 1
dryRun: true
staleDays: 90
ai:
  enabled: false
notifications:
  dashboard: true
  console: false
  githubComment: false
rules:
  - id: mark-large-pr
    when: pull_request.opened
    if:
      - field: changedFiles
        operator: gt
        value: 50
    then:
      - type: addLabel
        value: needs-focused-review
```

Rules are strict, versioned, bounded and uniquely named. Unknown keys, duplicate YAML keys, aliases/custom tags and duplicate IDs are rejected. Version 0's automations array can be migrated with the exported migrateConfig helper; no other legacy schema is implied.

## Conditions

All conditions in a rule must match. Fields: author, labels, changedFiles, paths, language, additions, deletions, ciStatus, branch, dependencyUpdate, issueAgeDays, firstTimeContributor, testsChanged, publicApiChanged. Operators: eq, neq, gt, gte, lt, lte, contains, matches (bounded glob), in.

Absent facts never match—even neq. Numeric comparisons do not coerce strings. PR path/test/API facts are enriched against the current GitHub PR head; stale delivery heads are not automated. publicApiChanged is a potential-break indicator, not a complete API-diff oracle. Scheduled scans provide the branch fact only.

Triggers: issues.opened/edited; pull_request.opened/synchronize/labeled; pull_request_review.submitted; workflow_run.failure/success; release.published; scheduled.scan.

## Actions

addLabel, removeLabel, assignUser, requestReviewer, postComment, createIssue, sendNotification and queueAnalysis. Value fields vary by action; consult the config schema and examples/policies.yml. Templates support only author, repository and number.

External writes require both approved dryRun=false and operator ALLOW_AUTOMATION_WRITES=true. Dry-run produces plans without side effects. Disabling/changing a rule invalidates queued plans. Unknown external outcomes require manual reconciliation; replay is deliberately blocked.

Notifications can be stored in the dashboard, logged as non-sensitive IDs, and optionally posted as GitHub comments under the same action ledger. Plugin actions are not accepted as YAML rule actions in this version.
