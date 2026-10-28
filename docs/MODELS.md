# Models

Model catalogue, licenses and how to add a model or engine. The catalogue lands in M6.

| Model                            | Source (pinned revision)                                      | License                                                               | Notes                                                                                                        |
| -------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Kokoro-82M v1.0 timestamped ONNX | `onnx-community/Kokoro-82M-v1.0-ONNX-timestamped` @ `dd4401a` | Apache-2.0                                                            | Default. WebGPU: `onnx/model.onnx` (fp32). WASM: `onnx/model_quantized.onnx` (q8). fp16 rejected (ADR 0003). |
| Piper `en_US-lessac-high`        | `rhasspy/piper-voices` @ `5041a7a`                            | Model MIT; **training data (Blizzard 2013 Lessac) research use only** | `personalUseOnly: true`                                                                                      |
| Piper `en_US-lessac-medium`      | same                                                          | same                                                                  | `personalUseOnly: true`                                                                                      |
| Piper `en_US-ljspeech-high`      | same                                                          | Model MIT; LJSpeech public domain                                     |                                                                                                              |
