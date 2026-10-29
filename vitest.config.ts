import path from 'node:path';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  test: {
    projects: [
      {
        plugins: [WxtVitest()],
        test: {
          name: 'unit',
          environment: 'happy-dom',
          include: ['tests/unit/**/*.test.{ts,tsx}'],
          setupFiles: ['tests/unit/setup.ts'],
        },
      },
      {
        // Real Chromium for DOM APIs happy-dom lacks: Range rects, CSS Custom Highlights, scrolling.
        // WxtVitest's fake-browser setup is Node-only, so this project just aliases `@`.
        resolve: { alias: { '@': path.resolve('src') } },
        test: {
          name: 'browser',
          include: ['tests/browser/**/*.test.{ts,tsx}'],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright({ launchOptions: { channel: 'chromium' } }),
            instances: [{ browser: 'chromium' }],
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/entrypoints/**', 'src/**/*.d.ts', 'src/engines/kokoro/headtts/**'],
      thresholds: {
        lines: 75,
        statements: 75,
        'src/core/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
      },
    },
  },
});
