/** Test-only helpers exposed on the options page in `--mode test` builds. */
import { ampToDb, rms } from '@/core/audio/dsp';
import type { BenchmarkCandidate } from '@/core/models/benchmark';
import type { VoiceChoice } from '@/core/settings';
import { openEngine, REGISTRY } from '@/engines/factory';
import { saveSettings } from '@/platform/settings';
import { benchmarkCandidate, createModelManager } from './models';

export const modelTestHooks = {
  async install(modelId: string, backend: 'webgpu' | 'wasm', sourceBase: string) {
    const m = REGISTRY.models.find((x) => x.id === modelId);
    if (!m) throw new Error(`unknown model ${modelId}`);
    const t0 = performance.now();
    await createModelManager(sourceBase).install(m, backend);
    return { ms: Math.round(performance.now() - t0) };
  },
  async verify(modelId: string) {
    const m = REGISTRY.models.find((x) => x.id === modelId);
    if (!m) throw new Error(`unknown model ${modelId}`);
    return createModelManager().verify(m, true);
  },
  async synth(choice: BenchmarkCandidate, voice: string, text: string) {
    const t0 = performance.now();
    const h = await openEngine(choice);
    const initMs = performance.now() - t0;
    try {
      const s0 = performance.now();
      const r = await h.engine.synthesize({ text, voiceId: voice, speed: 1, lang: 'en' });
      const ms = performance.now() - s0;
      const duration = r.pcm.length / r.sampleRate;
      return {
        backend: h.backend,
        sampleRate: r.sampleRate,
        duration,
        rmsDb: ampToDb(rms(r.pcm)),
        nan: r.pcm.some(Number.isNaN),
        words: r.words ?? [],
        initMs: Math.round(initMs),
        ms: Math.round(ms),
        rtf: ms / 1000 / duration,
      };
    } finally {
      h.terminate();
    }
  },
  benchmark: (c: BenchmarkCandidate) => benchmarkCandidate(c),
  setVoice: (voice: VoiceChoice) => saveSettings({ voice }),
};
