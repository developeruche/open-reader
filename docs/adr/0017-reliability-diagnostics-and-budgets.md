# 0017: Reliability, diagnostics and performance budgets (M10)

## Decisions

- **Fallback ladder** (`src/core/tts/fallback.ts`, `HostRuntime`): the background computes the
  rungs when a session starts (`SessionSettings.fallbacks`): the same engine on WASM if it was not
  already, then the other installed on-device engines (Piper first when Kokoro fails), then system
  voices. The host retries the chosen engine once with a fresh worker, then walks the rungs, both
  when the engine cannot start and when playback fails after the player's own retries (two, with
  250 ms × 2ⁿ backoff). Every switch is a visible notice with the error as its detail
  ("Switched to Piper because WebGPU failed."). "Nothing to read here" never triggers a switch.
- **Retry with backoff**: model downloads retry transient failures (network errors, truncated
  bodies, 408/429/5xx) up to 4 times, waiting 1, 2 and 4 s, resuming from the stored bytes each
  time; 4xx, checksum mismatches and cancellation fail at once. Ports already reconnect with
  exponential backoff (M5).
- **Watchdog** (unchanged from M4): no media progress for 2 s → re-buffer; three stalls → restart
  the engine worker at the same sentence.
- **Diagnostics** (`src/core/diagnostics/log.ts`, `Orchestrator.diagnostics()`): a 500-entry ring
  log in the service worker of host connections, state changes, commands (type only), notices and
  errors; never document text, titles or URLs. Hosts send `STATS` every second: RTF (mean of the
  last 8 synthesized segments), synthesized and cache-hit counts, buffer ahead, stalls, errors,
  fallbacks and restarts. The Diagnostics page polls the background each second and copies a JSON
  report with environment facts; keys named like key/token/secret/password are redacted. The log is
  in memory and starts over when the service worker restarts.
- **Runtime RTF suggestion** (§6.4.4): `RtfMonitor` is wired into the player. When RTF stays above
  0.9 for 30 s, it suggests a faster voice once per session and never switches by itself.
- **Memory caps and eviction**: the audio cache cap (Storage page, 256 MB–4 GB, default 512 MB)
  travels with the session settings to the hosts and evicts least recently used audio first. The
  prefetch window keeps at most 40 segments ahead plus 4 behind. Diagnostics logs hold 500 entries;
  the test-only debug log 5,000. Storage can clear the audio cache and stored PDFs.
- **Buffer ahead** counts seconds of speech at 1× after the current segment, using real durations
  once segments are ready, and the window is re-planned each time a segment becomes ready. Before,
  the 0.07 s/char estimate and counting the playing segment left 19 s ahead with the TestEngine.
- **Media clock anchoring**: Chrome fires `playing` before its media clock moves, and then
  `currentTime` runs ~64 ms, holds ~63 ms and continues (measured on macOS). `RenderedBackend` now
  announces a segment when `currentTime` first advances, and the player sends one settle correction
  300 ms into each segment. Followers keep the word index monotonic within a segment, so a backward
  correction holds the word instead of stepping back, and they ignore clock events between
  segments. Settle corrections are measured apart from steady-state drift.
- **Fast start** (deviation from §5.2.6): the plan splits a first sentence longer than 120
  characters at its first clause. Kokoro on WebGPU costs ≈ 200 ms + 6 ms per character, so a
  92-character first clause took 790–850 ms. A first sentence over 70 characters is now split at a
  clause boundary within 60 characters, else at the last word boundary before 60.
- **Kokoro WebGPU buffers**: `storageBufferCacheMode: 'lazyRelease'`. Kokoro's inputs vary in
  length and the default `bucket` cache kept growing (reading peak 3.26 GB → 2.40 GB, RTF
  unchanged at 0.105). `enableCpuMemArena: false` made no difference and was not kept.
- **Budgets in CI**: `pnpm budgets` (after `pnpm build`) checks gzipped JavaScript loaded up front:
  side panel ≤ 300 KB (§9.1), options ≤ 300 KB, service worker ≤ 120 KB, content script ≤ 250 KB,
  reader ≤ 450 KB. Engines, PDF.js's worker and WASM load lazily and are excluded. The PDF budgets
  (first page ≤ 2 s, layout ≤ 50 ms per page) and recovery within 3 s are E2E assertions.
- **Soak test** (`tests/e2e/soak.spec.ts`): a generated article read for `SOAK_MINUTES` (1 in the
  regular E2E run, 10 with `pnpm test:soak`), asserting no error, boundary waits ≤ 250 ms, zero
  watchdog stalls, ≥ 20 s buffered and steady-state drift ≤ 50 ms.
- **COOP/COEP stays off.** Extension pages get `SharedArrayBuffer` without cross-origin isolation
  (ADR 0003), so multi-threaded WASM already works (Kokoro q8 on 8 threads: RTF 0.38–0.41; Piper
  on 4 threads: 0.42–0.44). Isolation would only add breakage risk for fetches; nothing measured
  needs it.

## SLO results

Measured on Apple M3 Max, macOS 26.6, Playwright Chromium; full table in `docs/TESTING.md`. All
targets are met except memory.

**Memory miss (resolved in ADR 0018: 1.09 GB added, browser total 1.83 GB).** Kokoro fp32 on WebGPU plus the 100-page PDF peaks at ≈ 2.4 GB summed physical
footprint across the browser's processes: the extension renderer (reader page with the Kokoro
worker, ORT's WASM heap, PDF.js) ≈ 1.08 GB and the GPU process ≈ 0.87 GB, of which ≈ 0.33 GB is the
browser's idle baseline. The PDF itself costs ≈ 120 MB. Target: 1.5 GB.

Plan:

1. M11: evaluate smaller Kokoro variants on WebGPU (q8f16 / q4f16) with ORT 1.31's WebGPU EP. fp16
   was silent on this GPU in M1, so check audibility and run the quality harness before switching.
2. M11: release an idle engine worker after 5 minutes without playback in both hosts, and restore
   it on Play through the host-lost path. That frees ≈ 1 GB while a document stays open.
3. M14: confirm in Chrome's Task Manager on the owner's machine, which reports what users see.

ADR 0018 carried out items 1–2: smaller variants failed on this GPU, so the weights now load as
external data, and idle engines are released.
