# Testing

| Command              | What                                                                           |
| -------------------- | ------------------------------------------------------------------------------ |
| `pnpm test`          | Unit tests (Vitest, happy-dom, WXT `fakeBrowser`)                              |
| `pnpm test:coverage` | Unit tests with coverage thresholds                                            |
| `pnpm test:e2e`      | Builds the test-mode extension (`.output/chrome-mv3-test`) and runs Playwright |
| `pnpm test:soak`     | The soak test for 10 minutes (the E2E run includes a 1-minute soak)            |
| `pnpm budgets`       | Gzipped JS budgets of the production build (run after `pnpm build`)            |
| `pnpm test:models`   | Real engines: install, synthesis, offline read and the §9.1 SLO measurements   |

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

## Audio quality harness (local, before releases)

```bash
pnpm build:test && pnpm models:fetch all
pnpm synth:corpus            # renders the 10 passages with every voice → quality/out/<run>/
pnpm quality quality/out/<run>              # WER per voice, worst segments, gates
pnpm quality quality/out/<run> --update-baseline   # after a deliberate change
```

`quality/out/<run>/index.html` is a listening page for side-by-side comparison. Gates: overall WER
≤ 8%, no voice more than 1 point worse than `quality/baseline.json`. Harness unit tests:
`cd quality && uv run --with pytest python -m pytest -q`.

## Reliability and performance (M10)

- `tests/e2e/soak.spec.ts` reads a generated article for `SOAK_MINUTES` and asserts: no error,
  every segment-boundary wait ≤ 250 ms, zero watchdog stalls, ≥ 20 s buffered ahead and
  steady-state highlight drift ≤ 50 ms (test builds write `data-or-drift` on `<html>`).
- `tests/e2e/diagnostics.spec.ts` checks the Diagnostics page while reading: live numbers, a log
  without document text, and the copied JSON.
- `tests/models/slo.spec.ts` measures cold start, warm first audio, RTF, buffer ahead, stalls,
  recovery after the offscreen document closes (Kokoro and Piper), and memory with Kokoro reading
  the 100-page PDF for 2 minutes (what Open Reader adds on top of Chrome with a blank page, ADR 0018). Timings come from the service worker's debug log; memory is the sum of macOS
  physical footprints (`footprint`) over the browser's process tree (RSS elsewhere).
- `pnpm budgets` runs in CI after `pnpm build` (ADR 0017).

### Service-level objectives (§9.1)

Apple M3 Max, macOS 26.6, Playwright Chromium, 2026-10-29.

| Metric                                      | Target         | Measured                                                                                                      | Status |
| ------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------- | ------ |
| Time to first audio, warm voice             | ≤ 800 ms       | Kokoro WebGPU 498–573 ms; Piper Classic WebGPU 240–251 ms                                                     | Met    |
| Cold start (load from OPFS + init)          | ≤ 6 s          | Kokoro 1.5–2.2 s; Piper 2.1–3.0 s                                                                             | Met    |
| Stalls mid-playback                         | Zero           | 0 (models: 25 s per voice; soak: 0 over 10 min, longest boundary wait 13 ms)                                  | Met    |
| Buffer ahead of the playhead                | ≥ 20 s         | Kokoro 26.7 s; Piper 24.4 s; soak minimum 20.7 s                                                              | Met    |
| Recovery after the engine host restarts     | ≤ 3 s          | Offscreen closed: Kokoro 0.9–1.9 s, Piper 1.7–2.5 s, same sentence                                            | Met    |
| Recovery after the service worker is killed | ≤ 3 s          | The host keeps playing; the worker restores from `storage.session` (E2E)                                      | Met    |
| Position persisted                          | Every sentence | Saved on each boundary; reopening resumes at the saved sentence (E2E)                                         | Met    |
| Highlight drift over 10 minutes             | ≤ 50 ms        | 10-min soak: steady state p99 0.9 ms, max 16.5 ms (209 samples); start-up settle ≤ 67 ms, corrected at 300 ms | Met    |
| Side panel JS (excluding engines)           | ≤ 300 KB gz    | 156.9 KB                                                                                                      | Met    |
| PDF: first page of a 100-page PDF           | ≤ 2 s          | 54 ms                                                                                                         | Met    |
| PDF: layout analysis                        | ≤ 50 ms / page | 0.35 ms per page (35 ms for 100 pages)                                                                        | Met    |
| Memory (Kokoro fp32 WebGPU + 100-page PDF)  | ≤ 1.5 GB       | 1.09 GB added by Open Reader (browser total 1.83 GB; extension renderer 0.46 GB, ADR 0018)                    | Met    |

## Audiobook export and power features (M11)

- `tests/unit/runtime/export.test.ts`: MP3 and WAV through the real LAME WASM. It checks chapters
  read back by music-metadata and ffprobe (when installed), duration equal to the playback plan,
  loudness and true peak, cancel, file names and the chapter limit.
- `tests/unit/core/audio/loudness.test.ts`: BS.1770 references (997 Hz at −23 dBFS reads
  −26.0 LUFS mono at 48, 24 and 22.05 kHz), gating, true peak and the limiter.
- `tests/e2e/m11.spec.ts`: export from the side panel and from the PDF reader (files read from
  `chrome.downloads`), the sleep timer, and per-document rules.
- `tests/models/export.spec.ts` (`pnpm test:models`): a Kokoro export checked with FFmpeg's
  `ebur128` (±0.5 LU of −17 LUFS, ≤ −1.5 dBTP); `EXPORT_FORMAT=wav` checks WAV.

## OCR (M13)

- `tests/fixtures/pdf/scanned.pdf` (from `pnpm fixtures`): text rendered by Chromium at 2.5× and
  embedded as an image; `scanned.golden.json` holds the source text.
- `tests/unit/pdf/ocr.test.ts`: word boxes → PDF items, confidence filtering, and layout over OCR
  items.
- `tests/e2e/ocr.spec.ts`: offline recognition (every request outside the extension is aborted),
  ≥ 90% word recall against the source, the word cursor on the scanned page, and the cache on
  reopen.

## Release audits (M14)

- `tests/e2e/a11y.spec.ts` runs axe (WCAG 2.2 AA) over every Options section, the side panel in a
  session (Reader, Outline and Settings tabs, the export dialog), the reader with a PDF (both
  drawers, the export dialog), the empty reader and the storage confirmation, in light and dark.
  Serious and critical findings fail; moderate ones are printed. At 1.0.0 there are none of either.
- Acceptance for 1.0.0: `pnpm lint && pnpm typecheck && pnpm test:coverage && pnpm build &&
pnpm budgets && pnpm test:e2e`, `pnpm test:models` (including the offline read), `pnpm test:soak`,
  the quality harness, and the owner's 30-minute session in each mode (docs/PROGRESS.md).
