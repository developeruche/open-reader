# 0011: Audio pipeline, player machine and synthesis cache (M4)

## Context

M4 builds §5.3–§5.5: engine interfaces, post-processing, playback backends, the sync clock, the
prefetch scheduler, the synthesis cache and the XState player.

## Decisions

- **Machine owns state, Player owns effects.** `playerMachine` (XState 5) declares named actions
  (`requestSegment`, `startAudio`, `pauseAudio`, `stopAudio`, `applyRate`, `persist`, `replan`,
  `announceError`) that the `Player` supplies with `.provide()`. Navigation is injected as
  `PlayerNav` in context, so the machine is tested with table-driven transitions without audio.
  Actions read rate/voice/pacing from the machine context, because the snapshot is not yet
  updated while transition actions run (a voice change otherwise used the old voice).
- **States** follow §5.5 plus `resuming` (an eventless state that resumes loaded audio or loads
  it) and `seeking` doubling as the re-buffer target for voice changes and retries.
  `error` is never terminal: RETRY, PLAY, TOGGLE, SEEK, NEXT_SENTENCE and SET_VOICE leave it.
  Two automatic retries with 250 ms × 2ⁿ backoff precede `error`.
- **Cache stores raw engine output** (Int16 PCM + native timings) keyed by
  `engineId|modelId|modelVersion|voiceId|speed|normalizerVersion|spokenText`. Post-processing
  (trim, loudness, pause) is cheap and pacing-dependent, so it runs on every read.
- **Synchronous SHA-256** for cache keys (`src/core/util/sha256.ts`, checked against `node:crypto`).
  `crypto.subtle` resolves on a background thread, which made the key the slowest step for short
  strings and could not be driven by fake timers in tests. Large buffers (models) still use
  `crypto.subtle`.
- **Speed above 2×** synthesizes at model speed 1.25 and plays at `rate / 1.25` (§5.4.2). The
  model speed is part of the scheduler key, so crossing 2× re-plans upcoming segments.
  A listening test is still owed (M7 bake-off).
- **Prefetch window**: from the cursor until ≥ 20 s _and_ ≥ 4 segments are planned (estimated at
  0.07 s per spoken character), at most 40. Stale jobs are aborted on seek; up to 4 played results
  stay behind the playhead for "previous sentence".
- **Watchdog** checks media time every 500 ms; 2 s without progress → `AUDIO_STALLED` (re-buffer);
  the third stall in a row asks the host to restart the engine and shows a notice. DRIFT events go
  out every 2 s of playing time, across segment boundaries.
- **Sync words carry display ranges** (`displayStart/End` in the block's text), so visible contexts
  highlight without knowing about spoken text or offset maps.
- **Worker RPC** uses comlink; AbortSignals don't cross threads, so cancellation is a `cancel(id)`
  call that aborts the worker-side controller. PCM is transferred, not copied.

## Consequences

Measured in unit tests: drift stays under 50 ms over a simulated 10 minutes with 0.05% clock skew
and speed changes every 37 s; never more than one segment audible; positions persist on every
sentence boundary. The real `RenderedBackend` is exercised in Chromium from M5.
