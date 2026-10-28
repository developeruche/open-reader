# 0005: Offscreen audio, playback rate and the 30-second rule (spike 3)

Status: **works**, with a change to the offscreen reasons.

## Measurements

`preservesPitch` with a 440 Hz tone through `HTMLAudioElement` in the offscreen document, analysed
via `captureStream()` + `AnalyserNode` (16k FFT):

| playbackRate | Measured rate | Dominant frequency |
| ------------ | ------------- | ------------------ |
| 0.75         | 0.75          | 439 Hz             |
| 1.5          | 1.48          | 439 Hz             |
| 2.5          | 2.48          | 439 Hz             |
| 3.5          | 3.45          | 439 Hz             |

Pitch is preserved at every rate, and media time advances at the requested rate.

Lifetime after playing 0.5 s and pausing:

| Reasons                      | Result                                                                                  |
| ---------------------------- | --------------------------------------------------------------------------------------- |
| `AUDIO_PLAYBACK` only        | Closed by Chrome at **30 s**; the background saw the port disconnect at the same moment |
| `AUDIO_PLAYBACK` + `WORKERS` | Still open at 60 s (end of test)                                                        |

Recreating the document takes 10–20 ms; `chrome.runtime.getContexts` reliably reports presence.

## Decision

- Create the offscreen document with reasons `['AUDIO_PLAYBACK', 'WORKERS']`. The `WORKERS` reason
  is genuine (TTS runs in workers) and stops Chrome closing the host during pauses and long WASM
  synthesis (the first spike run lost a 40 s WASM job to the 30-second rule).
- Keep the full recovery design from §9.2 anyway: hosts still crash, and Chrome may change the
  policy. The E2E "pause 35 s and resume" test passes either way; a second test forces closure.
- Detect loss via the port's `onDisconnect`; confirm with `getContexts`.

## Consequences

Paused sessions resume instantly in the common case, and recovery is exercised by forced-close tests.
