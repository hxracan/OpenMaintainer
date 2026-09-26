export type Severity = 'info' | 'warning' | 'error';
export interface Finding {
  ruleId: string;
  severity: Severity;
  title: string;
  explanation: string;
  path?: string;
  line?: number;
}
export interface Recommendation {
  title: string;
  reason: string;
  findingIds: string[];
}
export interface Installation {
  id: number;
  account: string;
  suspended: boolean;
}
export interface Repository {
  id: number;
  installationId: number;
  fullName: string;
  defaultBranch: string;
  private: boolean;
  archived: boolean;
}
export interface Maintainer {
  id: number;
  login: string;
  role: 'admin' | 'maintain' | 'write';
}
export interface Contributor {
  login: string;
  firstTime: boolean;
  contributions: number;
}
export interface PullRequest {
  number: number;
  title: string;
  body: string;
  author: string;
  headSha: string;
  baseSha: string;
  labels: string[];
  createdAt: string;
}
export interface Issue {
  number: number;
  title: string;
  body: string;
  author: string;
  labels: string[];
  createdAt: string;
  updatedAt: string;
  state: 'open' | 'closed';
}
export interface Release {
  version: string;
  notes: string;
  prerelease: boolean;
  findings: Finding[];
}
export interface WorkflowRun {
  id: number;
  name: string;
  branch: string;
  status: string;
  conclusion: string | null;
}
export interface SourceFile {
  path: string;
  content: string;
}
export interface ChangedFile {
  path: string;
  status: 'added' | 'modified' | 'removed' | 'renamed';
  previousPath?: string;
  additions: number;
  deletions: number;
  patch?: string;
  before?: string;
  after?: string;
}
export interface RepositoryProfile {
  languages: Record<string, number>;
  packageManagers: string[];
  frameworks: string[];
  workspaces: string[];
  buildSystems: string[];
  testFrameworks: string[];
  manifests: string[];
  publicApis: string[];
  files: string[];
  findings: Finding[];
  fingerprint: string;
}
export interface RepositoryHealth {
  findings: Finding[];
  measuredAt: string;
  signals: Record<string, number | boolean | null>;
}
export interface Policy {
  allowWrites: boolean;
  allowedActions: string[];
}
export interface Plugin {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
}
export interface AuditEvent {
  actor: string;
  repositoryId: number | null;
  action: string;
  result: string;
  timestamp: string;
}
export type JobKind =
  | 'repository.sync'
  | 'repository.index'
  | 'pr.analyze'
  | 'issue.analyze'
  | 'issue.duplicates'
  | 'ci.analyze'
  | 'release.prepare'
  | 'automation.execute'
  | 'notification.send'
  | 'scheduled.scan'
  | 'webhook.process'
  | 'ai.analyze';
export interface DomainEvent {
  id: string;
  trigger: string;
  repository: string;
  repositoryId: number;
  installationId: number;
  actor: string;
  subjectNumber?: number;
  facts: Record<string, string | number | boolean | string[]>;
}
export interface AutomationRule {
  id: string;
  when: string;
  enabled: boolean;
}
