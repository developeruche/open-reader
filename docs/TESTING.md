# Testing

| Command              | What                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| `pnpm test`          | Unit tests (Vitest, happy-dom, WXT `fakeBrowser`)                              |
| `pnpm test:coverage` | Unit tests with coverage thresholds                                            |
| `pnpm test:e2e`      | Builds the test-mode extension (`.output/chrome-mv3-test`) and runs Playwright |

E2E uses a persistent Chromium context with `--load-extension`; the extension ID comes from the
service worker URL.
