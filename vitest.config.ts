import { defineConfig } from 'vitest/config';
import { WxtVitest } from 'wxt/testing/vitest-plugin';

export default defineConfig({
  plugins: [WxtVitest()],
  test: {
    environment: 'happy-dom',
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    setupFiles: ['tests/unit/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      exclude: ['src/entrypoints/**', 'src/**/*.d.ts'],
      thresholds: {
        lines: 75,
        statements: 75,
        'src/core/**': { lines: 90, functions: 90, branches: 85, statements: 90 },
      },
    },
  },
});
