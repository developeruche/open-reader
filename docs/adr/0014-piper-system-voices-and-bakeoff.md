# 0014: Piper, system voices and the voice bake-off (M7)

## Decisions

- **Piper adapter** (`src/engines/piper`): onnxruntime-web (WebGPU or up to 4 WASM threads) plus
  `piper_phonemize` (espeak-ng, GPL-3.0, bundled under `/piper/`). The emscripten module is created
  once per worker and reused (6–8 ms per call instead of ~25 ms); calls are serialized.
  `length_scale` = 1.1 ÷ speed, as in the owner's audiobook. Word timings are estimated by the player.
- **Estimated timings tuned on data.** The §5.4.4 heuristic (syllables + punctuation pauses + gap
  snapping) measured 176 ms mean boundary error against Kokoro's native timings on 200 sentences.
  A grid search on dumped timings (native words, voiced region, silent gaps) gave weights
  `0.25·syllables + 0.4·letters + 0.6` per word, punctuation pauses × 0.25, and contiguous words
  (a pause belongs to the word before it, as in Kokoro's own timings). Comparing in the speech region
  (the player clamps timings there): **110 ms mean, 155 ms p90** (held-out half: 113 ms). Target ≤ 120 ms.
  `pnpm test:models` enforces it.
- **System voices** (`src/engines/system`): `SystemEngine` (`caps.live`) plus `LiveBackend` over a
  `TtsApi`. The player plans an utterance with estimated timings instead of PCM; `chrome.tts` word
  events re-anchor the clock (`progress` → `DRIFT`). Rate changes restart speech at the current word.
  The offscreen document has no `chrome.tts`, so its `RemoteTts` sends `TTS` events to the background,
  which speaks and relays `TTS_EVENT`s back; the reader page uses `chrome.tts` directly. Voices marked
  `remote` are labelled "Online" and hidden while **Strict offline** (new setting, on by default) is on.
  With no model installed, sessions use system voices (zero download).
- **Quality harness** (`quality/`, uv + faster-whisper `small.en`, falling back to `base.en`):
  WER against the _spoken_ text after normalization (joined spelled letters, number words → digits,
  ordinals, `X.0` → `X`, compounds, aliases for our respellings). Gates: overall ≤ 8% and no voice
  regressing by more than 1 point against `quality/baseline.json`.
- **Corpus.** The owner's own articles are not in the repository; the bake-off uses ten passages
  written for the project (CC0) and a deterministic 200-sentence template corpus. Drop the owner's
  articles into `tests/fixtures/corpus/owner/` to extend it.

## Bake-off (Apple M3 Max, WebGPU, 10 passages)

| Voice                       | RTF   | First audio (warm) | WER  |
| --------------------------- | ----- | ------------------ | ---- |
| Kokoro Heart (`af_heart`)   | 0.108 | 671 ms             | 3.1% |
| Kokoro Michael              | 0.112 | 839 ms             | 3.1% |
| Kokoro Emma                 | 0.116 | 754 ms             | 2.4% |
| Kokoro George               | 0.119 | 852 ms             | 2.4% |
| Piper Classic (lessac high) | 0.048 | 196 ms             | 2.9% |
| Piper lessac medium         | 0.027 | 146 ms             | 2.4% |
| Piper LJSpeech high         | 0.047 | 254 ms             | 2.1% |

Overall WER 2.6%. Piper on WASM (4 threads): lessac-high RTF 0.44. First audio is the first full
sentence of a passage; the player's fast-start split makes real first audio shorter.

**Owner decision (listening test, 2026-10-29): the default voice stays Kokoro Heart (`af_heart`).**

## Follow-ups

- "Schnorr" (respelled "shnor") was transcribed as "snore" by ASR; check by ear in M11's
  pronunciation editor.
- The > 2× speed blend (model speed 1.25, ADR 0011) still needs its own listening check (M11).
