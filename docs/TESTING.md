# Testing

| Command              | What                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| `pnpm test`          | Unit tests (Vitest, happy-dom, WXT `fakeBrowser`)                              |
| `pnpm test:coverage` | Unit tests with coverage thresholds                                            |
| `pnpm test:e2e`      | Builds the test-mode extension (`.output/chrome-mv3-test`) and runs Playwright |

E2E uses a persistent Chromium context with `--load-extension`; the extension ID comes from the
service worker URL.

## Text pipeline tests

- `tests/unit/core/text/golden.test.ts`: 335 display → spoken cases, including the PSBT audiobook
  pronunciations. Add a case for every pronunciation bug found.
- `tests/unit/core/text/offsetMap.property.test.ts`: fast-check properties over random token mixes.
- Coverage gates: `src/core/**` ≥ 90% lines/functions/statements, ≥ 85% branches; overall ≥ 75% lines.

## Model tests (`pnpm test:models`)

Real engines in Chromium (WebGPU locally, WASM everywhere). Needs `pnpm models:fetch` first; a
local server stands in for Hugging Face. Covers install + full verification, non-silent output at
the right sample rate, monotonic word timings inside the audio, and the offline read (network cut
after install, zero outbound requests). CI runs them on `workflow_dispatch` with a model cache.
