# Models

## Catalogue (`models/registry.json`)

| Model                                 | Source (pinned revision)                                      | Size                                                 | License                                        | Notes                                                                                                                            |
| ------------------------------------- | ------------------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Kokoro-82M v1.0 timestamped ONNX      | `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped` @ `dd4401a` | 326 MB (WebGPU fp32) / 92 MB (WASM q8) + 2 MB voices | Apache-2.0                                     | Default. Native word timings. fp16 rejected (silent output, ADR 0003). Voices: `af_heart`, `am_michael`, `bf_emma`, `bm_george`. |
| Piper `en_US-lessac-high` ("Classic") | `rhasspy/piper-voices` @ `5041a7a`                            | 114 MB                                               | Model MIT; **training data research-use only** | `personalUseOnly: true`; notice shown before install. Estimated timings (110 ms mean error, ADR 0014).                           |
| Piper `en_US-lessac-medium`           | same                                                          | 63 MB                                                | same                                           | `personalUseOnly: true`                                                                                                          |
| Piper `en_US-ljspeech-high`           | same                                                          | 114 MB                                               | Model MIT; LJSpeech public domain              |                                                                                                                                  |

System voices (`chrome.tts`) need no download; online system voices are hidden while Strict
offline is on. They can't be exported as audio (chrome.tts produces no samples).

OCR (ADR 0020) bundles Tesseract's English `best_int` model (2.95 MB, Apache-2.0); it is not a
voice and is not in the registry.

Supporting data bundled with the extension: the en-us pronunciation dictionary from HeadTTS
(CMUdict 0.07 derivative, BSD-style license kept in the file header).

## Where models live

OPFS `models/<modelId>/<version>/<path>`; the installed index is `models.installed` in
`chrome.storage.local`. `pnpm models:fetch [all|<id>…]` fills `models/cache/` for tests and
`pnpm build:offline`.

Storage belongs to the extension's origin (`chrome-extension://ciacahokbkkhcpoefghbmnmilbaalcem`;
the manifest `key` pins the ID). Chrome deletes it all when the extension is removed, and
Options → Voices & models → **Remove** or Options → Storage free parts of it. Nothing is written
outside the browser profile.

## Adding a model

1. Add an entry to `models/registry.json`: pin `url`s to a commit (`/resolve/<sha>/`), give each
   file's `bytes` and `sha256` (`shasum -a 256`), mark backend-specific files with `backend`.
2. `pnpm test` validates the registry (unique ids, hashes, sizes, default voice).
3. If the license restricts use, set `license.personalUseOnly` and a `notice`; the UI asks before
   installing. Chrome Web Store builds (`pnpm build:store`, `pnpm zip:store`) leave these models out
   entirely (`publicRegistry`), so the store version offers Kokoro and Piper LJSpeech only.

## Adding an engine (worked example)

Say we add an engine `acme` that runs `acme.onnx` and returns per-character alignments.

1. **Adapter** `src/engines/acme/engine.ts` implementing `RenderEngine` (`src/core/tts/engine.ts`):
   - `caps`: `wordTimings: 'native'` (or `'estimated'` to let the player estimate them),
     `maxChars` (spoken characters per call), `backends`.
   - `init(model, { backend })`: read files with an injected `readFile(path)` (OPFS in the worker),
     and create the ONNX session from `sessionInput(bytes, backend)` (`src/engines/onnx/externalize.ts`).
     On WebGPU that loads the weights as external data, so onnxruntime's WASM heap stays small
     (ADR 0018). If input lengths vary, use
     `{ name: 'webgpu', storageBufferCacheMode: 'lazyRelease' }` as Kokoro does.
   - `synthesize({ text, voiceId, speed })`: return `{ pcm: Float32Array, sampleRate, words? }`
     where `words` are `{ charStart, charEnd, start, end }` in seconds and **spoken-text** offsets.
     Respect the `AbortSignal`.
2. **Worker** `src/engines/acme/worker.ts`: `exposeEngine(new AcmeEngine({...}), self)`.
3. **Factory**: in `openEngine()` (`src/engines/factory.ts`) spawn
   `new Worker(new URL('./acme/worker.ts', import.meta.url), { type: 'module', name: modelDir(manifest) })`,
   wrap it in `RemoteEngine`, and `init` it.
4. **Registry**: add `"engine": "acme"` to `EngineIdSchema` and a model entry.
5. **Fallbacks and names**: add `acme` to `RENDER_ENGINES` and `NAMES` in
   `src/core/tts/fallback.ts`, so a failure can move to it (or from it) with a readable notice.
   Pronunciation entries can target it with `engines: ['acme']`.
6. **Tests**: a unit test with a fake ONNX runtime (see `tests/unit/engines/kokoro`) and a smoke
   test in `tests/models/`.

Everything else (normalization, pronunciations, caching, prefetch, timing sync, highlighting,
the fallback ladder and audiobook export) works unchanged.
