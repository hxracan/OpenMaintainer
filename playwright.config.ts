import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm demo',
    url: 'http://localhost:3000/api/session',
    reuseExistingServer: false,
    timeout: 120000,
  },
});
