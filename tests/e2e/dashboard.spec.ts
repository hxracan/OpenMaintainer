import { expect, test } from '@playwright/test';

test('shows real seeded data and navigates repository findings', async ({ page }) => {
  await page.goto('/dashboard');
  await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
  await expect(page.getByText('Local demo instance')).toBeVisible();
  await expect(page.locator('.user')).toContainText('demo-maintainer');
  await page.screenshot({ path: 'docs/assets/dashboard.png', fullPage: true });
  await page.getByRole('link', { name: 'Repositories', exact: true }).click();
  await page
    .getByRole('link')
    .filter({ has: page.getByRole('heading', { name: 'demo/example-library' }) })
    .click();
  await expect(page.getByRole('heading', { name: 'Maintenance findings' })).toBeVisible();
});
test('queues and completes repository analysis through the worker', async ({ page }) => {
  await page.goto('/repositories/demo/example-library');
  const queued = page.waitForResponse((r) => r.request().method() === 'POST' && r.url().endsWith('/analyze'));
  await page.getByRole('button', { name: 'Analyze repository' }).click();
  const { jobId } = await (await queued).json();
  await expect
    .poll(async () => (await (await page.request.get(`/api/jobs/${jobId}`)).json()).data.status, {
      timeout: 30000,
    })
    .toBe('succeeded');
  await page.getByRole('button', { name: 'Refresh' }).click();
  await expect(page.getByRole('heading', { name: 'Maintenance findings' })).toBeVisible();
});
test('offers a guide and previews draft rules without saving them', async ({ page }) => {
  await page.goto('/getting-started');
  await expect(page.getByRole('heading', { name: 'Get your first analysis' })).toBeVisible();
  await page.getByRole('link', { name: 'Open repository settings' }).click();
  await page.getByLabel('Repository', { exact: true }).selectOption('demo/example-library');
  const configuration = page.getByLabel('Configuration (JSON)');
  await expect(configuration).toHaveValue(/"version": 1/);
  const saved = await configuration.inputValue();
  const draft = JSON.parse(saved);
  draft.rules = [
    {
      id: 'large-preview',
      when: 'pull_request.opened',
      if: [{ field: 'changedFiles', operator: 'gt', value: 50 }],
      // biome-ignore lint/suspicious/noThenProperty: declarative policy actions, not a promise.
      then: [{ type: 'addLabel', value: 'large' }],
    },
  ];
  draft.dryRun = false;
  await configuration.fill(JSON.stringify(draft, null, 2));
  await page.getByRole('button', { name: 'Preview rules', exact: true }).click();
  await expect(page.getByText('1 matching rules. No actions were executed.')).toBeVisible();
  await page.getByLabel('Example facts (JSON)').fill('{"changedFiles": 2}');
  await page.getByRole('button', { name: 'Preview rules', exact: true }).click();
  await expect(page.getByText('0 matching rules. No actions were executed.')).toBeVisible();
  const stored = await (await page.request.get('/api/repositories/demo/example-library/config')).json();
  expect(stored.data).toEqual(JSON.parse(saved));
});
test('runs duplicate checks and inspects the corresponding job history', async ({ page }) => {
  await page.goto('/issues');
  await page.getByText('Possible duplicates', { exact: true }).first().click();
  const queued = page.waitForResponse(
    (r) => r.request().method() === 'POST' && r.url().endsWith('/duplicates'),
  );
  await page.getByRole('button', { name: 'Find duplicate candidates' }).first().click();
  const { jobId } = await (await queued).json();
  await expect
    .poll(async () => (await (await page.request.get(`/api/jobs/${jobId}`)).json()).data.status, {
      timeout: 30000,
    })
    .toBe('succeeded');
  await expect(page.getByText(/Most recent 1000 locally synchronized issues/)).toBeVisible();
  await page.getByRole('link', { name: 'Jobs', exact: true }).click();
  await page.getByLabel('Filter jobs on this page').fill(jobId);
  await expect(page.getByRole('heading', { name: 'issue.duplicates', exact: true })).toBeVisible();
  await page.getByText('History and result', { exact: true }).click();
  await expect(page.getByText(jobId, { exact: true })).toBeVisible();
  const refreshed = page.waitForResponse(
    (r) => r.request().method() === 'GET' && r.url().includes('/api/jobs?') && r.url().includes('refresh=1'),
  );
  await page.getByRole('button', { name: 'Refresh' }).click();
  expect((await refreshed).ok()).toBe(true);
});
test('supports policy editing and mobile navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  await page.getByLabel('Repository', { exact: true }).selectOption('demo/example-library');
  await expect(page.getByLabel('Configuration (JSON)')).toHaveValue(/"dryRun": true/);
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByRole('status')).toContainText('Policy saved');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
