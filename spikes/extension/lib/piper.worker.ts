// Spike: Piper VITS ONNX in a WASM worker with piper_phonemize (espeak-ng) bundled locally.
import * as ort from 'onnxruntime-web/webgpu';
// @ts-expect-error -- emscripten CommonJS module without types.
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';

interface Req { voiceBase: string; voice: string; sentences: string[]; lengthScale: number; backend?: 'wasm' | 'webgpu'; threads?: number }
const log = (msg: string) => self.postMessage({ type: 'log', msg });

async function phonemize(text: string, espeakVoice: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    createPiperPhonemize({
      print: (data: string) => resolve(JSON.parse(data).phoneme_ids),
      printErr: (m: string) => reject(new Error(m)),
      locateFile: (u: string) => new URL(`/piper/${u.split('/').pop()}`, self.location.origin).href,
    }).then((mod: { callMain(args: string[]): void }) =>
      mod.callMain(['-l', espeakVoice, '--input', JSON.stringify([{ text }]), '--espeak_data', '/espeak-ng-data']),
    );
  });
}

self.onmessage = async (ev: MessageEvent<Req>) => {
  const r = ev.data;
  try {
    ort.env.wasm.wasmPaths = new URL('/ort/', self.location.origin).href;
    ort.env.wasm.numThreads = r.threads ?? 1;
    const t0 = performance.now();
    const [model, cfg] = await Promise.all([
      fetch(`${r.voiceBase}/${r.voice}.onnx`).then((x) => x.arrayBuffer()),
      fetch(`${r.voiceBase}/${r.voice}.onnx.json`).then((x) => x.json()),
    ]);
    const tFetch = performance.now();
    const session = await ort.InferenceSession.create(new Uint8Array(model), { executionProviders: [r.backend ?? 'wasm'] });
    const tInit = performance.now();
    log(`piper ${r.voice} ready`);
    const sr = cfg.audio.sample_rate as number;
    const results = [];
    for (const [i, text] of ['Warm up the engine.', ...r.sentences].entries()) {
      const p0 = performance.now();
      const ids = await phonemize(text, cfg.espeak.voice);
      const phonMs = performance.now() - p0;
      const s0 = performance.now();
      const out = await session.run({
        input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
        input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
        scales: new ort.Tensor('float32', new Float32Array([cfg.inference.noise_scale, r.lengthScale, cfg.inference.noise_w]), [3]),
      });
      const synthMs = performance.now() - s0 + phonMs;
      const pcm = out.output!.data as Float32Array;
      if (i === 0) continue;
      const audioSec = pcm.length / sr;
      results.push({ text, ids: ids.length, phonMs: Math.round(phonMs), synthMs: Math.round(synthMs), audioSec: +audioSec.toFixed(3), rtf: +(synthMs / 1000 / audioSec).toFixed(3), sampleRate: sr, pcm: i === 1 ? Array.from(pcm) : undefined });
    }
    const totalAudio = results.reduce((a, x) => a + x.audioSec, 0);
    const totalSynth = results.reduce((a, x) => a + x.synthMs, 0) / 1000;
    self.postMessage({ voice: r.voice, backend: r.backend ?? 'wasm', threads: r.threads ?? 1, isolated: self.crossOriginIsolated, fetchMs: Math.round(tFetch - t0), initMs: Math.round(tInit - tFetch), rtf: +(totalSynth / totalAudio).toFixed(3), firstAudioMs: results[0]?.synthMs, results });
  } catch (e) {
    self.postMessage({ voice: r.voice, error: String(e instanceof Error ? e.stack ?? e.message : e) });
  }
};
