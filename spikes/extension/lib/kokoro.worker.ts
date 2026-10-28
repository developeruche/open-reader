// Spike: Kokoro-82M timestamped ONNX in a worker inside the offscreen document.
import * as ort from 'onnxruntime-web/webgpu';
// @ts-expect-error -- HeadTTS ships untyped ES modules.
import { Language } from './headtts/language-en-us.mjs';

interface Req { modelBase: string; variant: string; backend: 'webgpu' | 'wasm'; sentences: string[]; voice: string; threads?: number }

const FRAME_RATE = 40; // durations are in 25 ms frames (24 kHz, hop 600)
const SR = 24000;
const STYLE_DIM = 256;
const log = (msg: string) => self.postMessage({ type: 'log', msg });

self.onmessage = async (ev: MessageEvent<Req>) => {
  const r = ev.data;
  try {
    ort.env.wasm.wasmPaths = new URL('/ort/', self.location.origin).href;
    ort.env.wasm.numThreads = r.threads ?? 1;
    const t0 = performance.now();
    const [modelBuf, tok, voiceBuf] = await Promise.all([
      fetch(`${r.modelBase}/onnx/${r.variant}`).then((x) => x.arrayBuffer()),
      fetch(`${r.modelBase}/tokenizer.json`).then((x) => x.json()),
      fetch(`${r.modelBase}/voices/${r.voice}.bin`).then((x) => x.arrayBuffer()),
    ]);
    const tFetch = performance.now();
    const vocab = tok.model.vocab as Record<string, number>;
    const lang = new Language({});
    await lang.loadDictionary(new URL('/headtts/en-us.txt', self.location.origin).href);
    const session = await ort.InferenceSession.create(new Uint8Array(modelBuf), {
      executionProviders: [r.backend],
      graphOptimizationLevel: 'all',
    });
    const tInit = performance.now();
    log(`kokoro ${r.backend} session ready`);
    const voice = new Float32Array(voiceBuf);
    const results = [];
    for (const [i, text] of ['Warm up the engine.', ...r.sentences].entries()) {
      const g = lang.generate(text) as { phonemes: string[]; metadata: { words: string[]; wtimes: number[]; wdurations: number[] }; silences: [number, number][] };
      const phonemeStr = g.phonemes.join('');
      const ids = [0, ...[...phonemeStr].map((c) => vocab[c]).filter((x): x is number => x !== undefined), 0];
      const nTok = Math.min(Math.max(ids.length - 2, 0), 509);
      const style = voice.slice(nTok * STYLE_DIM, nTok * STYLE_DIM + STYLE_DIM);
      const s0 = performance.now();
      const out = await session.run({
        input_ids: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        style: new ort.Tensor('float32', style, [1, STYLE_DIM]),
        speed: new ort.Tensor('float32', new Float32Array([1]), [1]),
      });
      const synthMs = performance.now() - s0;
      const wave = out.waveform!.data as Float32Array;
      const dur = Array.from(out.durations!.data as ArrayLike<number | bigint>, Number);
      const times = [0];
      for (const d of dur) times.push((times.at(-1) ?? 0) + d / FRAME_RATE);
      const m = g.metadata;
      const words = m.words.map((w, k) => ({ w, start: +(times[(m.wtimes[k] ?? 0) + 1] ?? 0).toFixed(3), end: +(times[(m.wdurations[k] ?? 0) + 1] ?? 0).toFixed(3) }));
      const audioSec = wave.length / SR;
      if (i === 0) continue; // warm-up
      results.push({ text, phonemes: phonemeStr, tokens: ids.length, outputNames: session.outputNames, durationsLen: dur.length, sumDurSec: +(times.at(-1) ?? 0).toFixed(3), audioSec: +audioSec.toFixed(3), synthMs: Math.round(synthMs), rtf: +(synthMs / 1000 / audioSec).toFixed(3), words, pcm: i === 1 ? Array.from(wave) : undefined });
    }
    const totalAudio = results.reduce((a, x) => a + x.audioSec, 0);
    const totalSynth = results.reduce((a, x) => a + x.synthMs, 0) / 1000;
    self.postMessage({ backend: r.backend, variant: r.variant, fetchMs: Math.round(tFetch - t0), initMs: Math.round(tInit - tFetch), rtf: +(totalSynth / totalAudio).toFixed(3), firstAudioMs: results[0]?.synthMs, results });
  } catch (e) {
    self.postMessage({ backend: r.backend, variant: r.variant, error: String(e instanceof Error ? e.stack ?? e.message : e) });
  }
};
