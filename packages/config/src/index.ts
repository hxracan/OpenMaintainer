import { AppError, boundedText } from '@openmaintainer/shared';
import { parseDocument } from 'yaml';
import { z } from 'zod';
export const conditionSchema = z
  .object({
    field: z.enum([
      'author',
      'labels',
      'changedFiles',
      'paths',
      'language',
      'additions',
      'deletions',
      'ciStatus',
      'branch',
      'dependencyUpdate',
      'issueAgeDays',
      'firstTimeContributor',
      'testsChanged',
      'publicApiChanged',
    ]),
    operator: z.enum(['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'contains', 'matches', 'in']),
    value: z.union([
      z.string().max(500),
      z.number().finite(),
      z.boolean(),
      z.array(z.string().max(200)).max(100),
    ]),
  })
  .strict();
export const actionSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('addLabel'), value: z.string().min(1).max(50) }).strict(),
  z.object({ type: z.literal('removeLabel'), value: z.string().min(1).max(50) }).strict(),
  z.object({ type: z.literal('assignUser'), value: z.string().regex(/^[\w-]{1,39}$/) }).strict(),
  z.object({ type: z.literal('requestReviewer'), value: z.string().regex(/^[\w-]{1,39}$/) }).strict(),
  z.object({ type: z.literal('postComment'), value: z.string().min(1).max(10000) }).strict(),
  z
    .object({
      type: z.literal('createIssue'),
      title: z.string().min(1).max(256),
      body: z.string().max(10000),
    })
    .strict(),
  z.object({ type: z.literal('sendNotification'), value: z.string().min(1).max(10000) }).strict(),
  z
    .object({
      type: z.literal('queueAnalysis'),
      value: z.enum(['repository.index', 'pr.analyze', 'issue.analyze', 'ci.analyze']),
    })
    .strict(),
]);
export const triggers = [
  'issues.opened',
  'issues.edited',
  'pull_request.opened',
  'pull_request.synchronize',
  'pull_request.labeled',
  'pull_request_review.submitted',
  'workflow_run.failure',
  'workflow_run.success',
  'release.published',
  'scheduled.scan',
] as const;
export const ruleSchema = z
  .object({
    id: z.string().regex(/^[a-z0-9-]{1,64}$/),
    when: z.enum(triggers),
    enabled: z.boolean().default(true),
    if: z.array(conditionSchema).max(30).default([]),
    // biome-ignore lint/suspicious/noThenProperty: declarative YAML action list, never a thenable function.
    then: z.array(actionSchema).min(1).max(20),
  })
  .strict();
export const configSchema = z
  .object({
    version: z.literal(1),
    dryRun: z.boolean().default(true),
    rules: z.array(ruleSchema).max(100).default([]),
    labels: z.record(z.string(), z.string().max(50)).default({}),
    staleDays: z.number().int().min(7).max(730).default(90),
    notifications: z
      .object({
        dashboard: z.boolean().default(true),
        console: z.boolean().default(false),
        githubComment: z.boolean().default(false),
      })
      .strict()
      .default({ dashboard: true, console: false, githubComment: false }),
    ai: z
      .object({ enabled: z.boolean().default(false) })
      .strict()
      .default({ enabled: false }),
  })
  .strict()
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    for (const [i, r] of c.rules.entries()) {
      if (ids.has(r.id))
        ctx.addIssue({ code: 'custom', path: ['rules', i, 'id'], message: 'Duplicate rule ID' });
      ids.add(r.id);
    }
  });
export type Config = z.infer<typeof configSchema>;
export type Rule = z.infer<typeof ruleSchema>;
export type Condition = z.infer<typeof conditionSchema>;
export type Action = z.infer<typeof actionSchema>;
export function parseConfig(source: string): Config {
  boundedText(source, 128_000);
  const doc = parseDocument(source, { uniqueKeys: true, customTags: [] });
  if (doc.errors.length) throw new AppError('CONFIG_YAML', doc.errors.map((e) => e.message).join('; '));
  if (doc.warnings.length) throw new AppError('CONFIG_YAML', 'Unsupported YAML tags or directives');
  const result = configSchema.safeParse(doc.toJS({ maxAliasCount: 0 }));
  if (!result.success)
    throw new AppError(
      'CONFIG_SCHEMA',
      result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '),
    );
  return result.data;
}
export function migrateConfig(input: unknown): Config {
  const legacy = z
    .object({ version: z.literal(0), automations: z.array(ruleSchema).default([]) })
    .strict()
    .safeParse(input);
  return configSchema.parse(
    legacy.success ? { version: 1, dryRun: true, rules: legacy.data.automations } : input,
  );
}
export const defaultConfig = (): Config => configSchema.parse({ version: 1 });
