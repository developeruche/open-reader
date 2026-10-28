# 0003: Kokoro timestamped ONNX in the offscreen document (spike 1)

Status: **works as planned**, with two changes (fp32 only on WebGPU; raw onnxruntime-web).

## Context

Spike 1 ran `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped` (revision `dd4401a`) inside a
module worker started by the offscreen document, with the HeadTTS en-us G2P (CMU dictionary plus
NRL letter-to-sound rules) and voice `af_heart`. Machine: Apple M3 Max, Chromium 156 (Playwright),
headless. Five reference sentences after one warm-up sentence.

## Measurements

| Variant                           | Backend | Threads | Init   | First audio (≈3.8 s sentence) | RTF       | Output                            |
| --------------------------------- | ------- | ------- | ------ | ----------------------------- | --------- | --------------------------------- |
| `model.onnx` fp32 (326 MB)        | WebGPU  | –       | 1.35 s | 0.40 s                        | **0.106** | Correct (ASR exact)               |
| `model_fp16.onnx` (163 MB)        | WebGPU  | –       | 1.08 s | 0.26 s                        | 0.064     | **Silent: every sample is 0/NaN** |
| `model_quantized.onnx` q8 (92 MB) | WASM    | 1       | 1.02 s | 6.85 s                        | 1.85      | Correct                           |
| q8                                | WASM    | 4       | 1.02 s | 2.21 s                        | 0.59      | Correct                           |
| q8                                | WASM    | 8       | 0.95 s | 1.45 s                        | 0.38      | Correct                           |

- WebGPU is available in the offscreen document and in its workers (`navigator.gpu`, Apple
  `metal-3`, `shader-f16`). Only `chrome.runtime` is exposed there, as documented.
- Output names are exactly `waveform` and `durations`. `durations` has one entry per input token
  (including the two `$` pad tokens) in frames of 25 ms (`frameRate = 40`, i.e. 24 kHz / hop 600).
  Σdurations / 40 matches the waveform length within 2% on every sentence.
- Word times = cumulative token durations at each word's first and last phoneme (+1 for the leading
  pad), as HeadTTS does. All word times were monotonic and inside the audio.
- `SharedArrayBuffer` is available in extension pages without COOP/COEP (`crossOriginIsolated`
  is false), so onnxruntime-web's multi-threaded WASM works as-is.

## Decision

- WebGPU uses **fp32** `model.onnx`. fp16 is rejected: it produces silence on this GPU. Keep the
  benchmark (§6.4) checking for a non-silent result, so a broken variant can never be auto-selected.
- WASM fallback uses q8 `model_quantized.onnx` with `numThreads = min(8, hardwareConcurrency - 2)`.
- Use **onnxruntime-web directly**, not transformers.js: the tokenizer is a character vocabulary
  (normalizer strips characters outside the vocab, `$` = 0 wraps the sequence), so a 20-line
  tokenizer replaces a large dependency and its CDN defaults.
- Port HeadTTS's en-us G2P and timing logic to TypeScript (MIT, credited in THIRD_PARTY.md).
- Normalization must run before G2P: HeadTTS phonemized "Dr." as "drive".

## Consequences

Kokoro on WebGPU is ~9× faster than real time here; the default engine rule (RTF ≤ 0.6 on WebGPU)
selects it. Machines without WebGPU fall back to Piper (ADR 0004).
