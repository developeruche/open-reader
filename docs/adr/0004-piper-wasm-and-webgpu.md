# 0004: Piper in the browser with bundled assets (spike 2)

Status: **works**, with a change: run Piper on WebGPU or multi-threaded WASM, not single-threaded WASM.

## Context

Spike 2 ran Piper voices (rhasspy/piper-voices revision `5041a7a`) with onnxruntime-web 1.31.1 in
a module worker inside the offscreen document. Phonemes come from `@diffusionstudio/piper-wasm`
1.0.0 (`piper_phonemize` = espeak-ng compiled to WASM; 18 MB `.data` with espeak-ng-data), loaded
from extension URLs through emscripten's `locateFile`. No CDN is touched. `length_scale` 1.1.

`@mintplex-labs/piper-tts-web` was inspected: it hard-codes HF/jsDelivr/cdnjs URLs and its own OPFS
cache. Its inference code is ~40 lines, so we call onnxruntime-web and piper_phonemize directly.

## Measurements (Apple M3 Max)

| Voice                 | Backend    | Threads | Init  | First audio | RTF                              |
| --------------------- | ---------- | ------- | ----- | ----------- | -------------------------------- |
| lessac-high (114 MB)  | WASM       | 1       | 1.8 s | 4.9 s       | **1.62** (slower than real time) |
| lessac-high           | WASM       | 4       | 2.3 s | 1.4 s       | 0.42                             |
| lessac-high           | **WebGPU** | –       | 2.2 s | 0.15–0.20 s | **0.04–0.05**                    |
| lessac-medium (63 MB) | WASM       | 1       | 1.4 s | 0.59 s      | 0.19                             |
| lessac-medium         | WASM       | 4       | 2.0 s | 0.18 s      | 0.05                             |

COOP/COEP made no difference (threads work without isolation; see ADR 0003). Every output
transcribed correctly with faster-whisper `base.en`. Phonemization takes ~25 ms per call because the
spike re-instantiates the emscripten module each time.

## Decision

- The Piper adapter supports `webgpu` and `wasm` backends. WASM uses
  `numThreads = min(4, hardwareConcurrency - 2)`. Single-threaded WASM is only a last resort.
- The §6.4 benchmark measures Piper on WebGPU as well as WASM.
- Instantiate `piper_phonemize` once per worker and reuse it.
- Bundle `piper_phonemize.{js,wasm,data}`; record espeak-ng (GPL-3.0) in THIRD_PARTY.md.
- No COOP/COEP (also answers the §4.5 / M10 question for now).

## Consequences

"Classic" (lessac-high) is real-time on any machine with WebGPU or ≥ 4 cores.
