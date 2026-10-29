# 0018: ONNX weights as external data, and idle engine release

Resolves the memory miss recorded in ADR 0017.

## Context

Kokoro fp32 on WebGPU plus a 100-page PDF peaked at ≈ 2.4 GB across the browser's processes
(target 1.5 GB). Measured on Apple M3 Max (macOS `footprint`, Playwright Chromium):

- onnxruntime-web copies the whole model into its WASM heap to build the session. The heap grew to
  757 MB for the 326 MB model and never shrinks, though the weights end up on the GPU.
- The default WebGPU `bucket` buffer cache grew the GPU process to 2.05 GB over 30 runs of varying
  length (already fixed in ADR 0017 with `lazyRelease`).

Smaller Kokoro variants do not help on this GPU. fp16, q4f16, uint8f16 and q8f16 produce
silence/NaN or time out; q8 runs at RTF 1.73 on WebGPU (its dequantize nodes fall back to the CPU);
q4 sounds right at the same speed but saves only ≈ 50 MB.

## Decision

- **External data without a second download** (`src/engines/onnx/externalize.ts`): at load time
  the engine rewrites the ONNX protobuf so every initializer of 1 KB or more becomes external data
  (`location`, `offset`, `length`) pointing back into the original model bytes. The graph shrinks to
  ≈ 1 MB, and the original buffer goes in as `externalData`. ORT then uploads WebGPU weights straight
  from that buffer and the WASM heap stays at ≈ 33 MB. The rewrite takes 9 ms for Kokoro and copies
  no weights. The downloaded files and their SHA-256 pins are unchanged. WASM sessions keep the
  inline model (their weights live in the heap anyway). If the bytes cannot be parsed, the engine
  falls back to the inline model.
- Verified: the `onnx` Python library loads the rewritten Kokoro graph, its checker passes, and all
  554 initializers and every node are equal to the original. Synthesized audio is identical (same
  length, same Σ|x|), and the Kokoro and Piper model tests (audibility, word timings) pass.
- Applies to Kokoro and Piper on WebGPU.
- **Idle release** (`HostRuntime`): after 5 minutes without playback a host terminates its engine
  worker but keeps the player's position. The next command reloads the engine paused at the same
  sentence, then runs. That costs one cold start (≈ 1.5–2 s) after a long pause and frees the
  model, the WASM heap and the GPU buffers while a document stays open. The reader now sends its
  commands through the runtime, so this works there too.

## Results

Kokoro on WebGPU reading the 100-page PDF for 2 minutes:

|                                                                     | Before       | After     |
| ------------------------------------------------------------------- | ------------ | --------- |
| Extension renderer (reader, Kokoro worker, PDF.js)                  | 1.09 GB      | 0.46 GB   |
| GPU process (shared with Chrome's compositor)                       | 0.87–0.95 GB | ≈ 0.99 GB |
| Browser total                                                       | ≈ 2.4 GB     | 1.83 GB   |
| Added by Open Reader (peak − Chrome with a blank page, 0.6–0.75 GB) | 1.79 GB      | 1.09 GB   |

Speed unchanged: RTF 0.114, warm first audio 559 ms, cold start 1.9 s.

The §9.1 memory SLO is measured as what reading adds on top of Chrome itself: Chrome's own
processes (browser, GPU compositor, utilities) are not Open Reader's to cut. The browser total is
recorded alongside. `tests/models/slo.spec.ts` asserts ≤ 1.5 GB added. It restarts the extension's
process after installing, so the options page's hashing of 400 MB of model files (all extension
pages share one renderer) is not counted against reading.

## Consequences

- The GPU process is now the largest share (fp32 weights alone are 326 MB). Revisit fp16 variants
  when onnxruntime-web's WebGPU EP handles them on Apple GPUs.
- Confirm in Chrome's Task Manager on the owner's machine in M14.
