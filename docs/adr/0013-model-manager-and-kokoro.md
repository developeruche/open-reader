# 0013: Model manager and the Kokoro engine (M6)

## Decisions

- **Registry** `models/registry.json` pins every file to a Hugging Face revision with size and
  SHA-256, validated by zod in unit tests and at runtime (`REGISTRY` in `src/engines/factory.ts`).
- **Per-backend installs.** Files tagged `backend: webgpu|wasm` are installed only for the backend
  in use (Kokoro: 326 MB fp32 for WebGPU, 92 MB q8 for WASM); installing the other later merges
  into `backend: 'any'`.
- **Downloads** are streamed into `<path>.part` in OPFS through one writable per file, resume with
  `Range` (restart when the server ignores it), verify SHA-256 with `crypto.subtle` (0.2 s for
  326 MB, ADR 0008), then move into place. Pause = abort and keep the partial; Cancel removes the
  model; Retry/Resume re-runs the install. A corrupted partial from an earlier attempt fails the
  hash and is discarded.
- **Integrity on load** checks sizes; **Repair** runs a full hash check and re-downloads bad files.
  We skip the plan's per-load "SHA-256 spot check": a full hash is cheap enough for Repair, and a
  partial hash would need extra per-file metadata Hugging Face does not publish.
- **Offline pack.** `pnpm models:fetch` downloads into `models/cache/<engine>/` (gitignored) instead
  of `public/models/`, because everything in `public/` is copied into every build.
  `pnpm build:offline` adds the Kokoro files at `/models/<id>/<version>/…` through a WXT hook; the
  manager tries that bundled URL first and falls back to the registry URL.
- **Kokoro adapter** uses onnxruntime-web directly (ADR 0003) with the vendored HeadTTS en-us G2P
  (`src/engines/kokoro/headtts`, unmodified, MIT) and its CMUdict-derived dictionary
  (`assets/g2p/en-us.txt`, bundled as `/g2p/en-us.txt`). HeadTTS words concatenate exactly to the
  input, so character offsets are cumulative; a phoneme→token map keeps timings right if any
  phoneme is outside the vocabulary. Sentences over 510 tokens are split at a space and joined.
- **Workers read OPFS directly**; the model directory reaches the worker as its `name`.
- **One ORT build.** Vite resolves onnxruntime-web with the `onnxruntime-web-use-extern-wasm`
  condition, so only `/ort/ort-wasm-simd-threaded.asyncify.{mjs,wasm}` ship (the default build
  emitted a second 28 MB copy). The test build fell from 62 MB to 33 MB.
- **Benchmark** (§6.4) runs in the page: warm-up, three reference sentences per installed
  candidate, RTF and first-audio time, and an audibility check (≥ −50 dBFS RMS) so a silent variant
  can never win. The choice becomes the default voice. `RtfMonitor` implements the 30-second
  starvation rule for the runtime suggestion (wired in M10).
- **Onboarding order** changed to Welcome → Download → Benchmark → Voice → Shortcuts → Done.
  Voice samples are synthesized locally, which needs the model first; remote sample files would
  break offline-first.
- **Engine failures are visible**: if the engine cannot start (e.g. no model), the host emits an
  error status and a notice pointing to Voices & models. System voices as the zero-download
  fallback arrive in M7.

## Measurements (Apple M3 Max, Chromium 156, `pnpm test:models`)

| Backend              | Install from local server | Engine init | First sentence (cold)                                       |
| -------------------- | ------------------------- | ----------- | ----------------------------------------------------------- |
| WebGPU (fp32)        | 1.5 s (326 MB)            | 1.8 s       | RTF 0.55 (includes shader compile; warm RTF 0.11, ADR 0003) |
| WASM (q8, 8 threads) | 0.6 s (92 MB)             | 1.5 s       | RTF 0.41                                                    |

The offline test reads a page with Kokoro after `setOffline(true)` and aborting every route, with
zero outbound requests.
