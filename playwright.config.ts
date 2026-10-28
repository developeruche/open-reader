import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 60_000,
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }], ['list']] : 'list',
  use: { trace: 'retain-on-failure' },
  // Baselines are per platform; CI (Linux) records its own on first run.
  snapshotPathTemplate: '{testDir}/__screenshots__/{platform}/{arg}{ext}',
  updateSnapshots: process.env.CI ? 'missing' : 'none',
  expect: { toHaveScreenshot: { animations: 'disabled', caret: 'hide' } },
});
