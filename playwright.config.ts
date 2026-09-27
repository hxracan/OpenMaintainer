import { defineConfig } from '@playwright/test';
import { demoPort } from './scripts/demo-ports.js';
export default defineConfig({
  testDir: 'tests/e2e',
  workers: 1,
  use: { baseURL: `http://localhost:${demoPort}`, trace: 'retain-on-failure' },
  webServer: {
    command: 'pnpm demo',
    url: `http://localhost:${demoPort}/api/session`,
    reuseExistingServer: false,
    timeout: 120000,
  },
});
