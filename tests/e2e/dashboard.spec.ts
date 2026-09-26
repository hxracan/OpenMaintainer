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
test('supports policy editing and mobile navigation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/settings');
  await page.getByLabel('Repository', { exact: true }).selectOption('demo/example-library');
  await expect(page.getByLabel('Configuration (JSON)')).toHaveValue(/"dryRun": true/);
  await page.getByRole('button', { name: 'Save policy' }).click();
  await expect(page.getByRole('status')).toContainText('Policy saved');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
