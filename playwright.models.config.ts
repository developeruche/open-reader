import { defineConfig } from '@playwright/test';

/** Real-model smoke and offline tests (`pnpm test:models`). Needs models/cache (pnpm models:fetch). */
export default defineConfig({
  testDir: 'tests/models',
  timeout: 300_000,
  workers: 1,
  reporter: 'list',
  use: { trace: 'retain-on-failure' },
});
