/** Test-only helpers exposed on the options page in `--mode test` builds. */
import { ampToDb, rms, trimSilence } from '@/core/audio/dsp';
import { boundaryError, estimateTimings } from '@/core/audio/timing';
import { segmentWords } from '@/core/text/segment';
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
  /** Raw engine output for the bake-off (samples as a plain array). */
  async synthRaw(choice: BenchmarkCandidate, voice: string, texts: string[]) {
    const h = await openEngine(choice);
    try {
      await h.engine.synthesize({ text: 'Warm up.', voiceId: voice, speed: 1, lang: 'en' });
      const out = [];
      for (const text of texts) {
        const t0 = performance.now();
        const r = await h.engine.synthesize({ text, voiceId: voice, speed: 1, lang: 'en' });
        out.push({
          ms: performance.now() - t0,
          sampleRate: r.sampleRate,
          pcm: Array.from(r.pcm),
          words: r.words ?? null,
        });
      }
      return out;
    } finally {
      h.terminate();
    }
  },
  /**
   * §5.4.4 target: estimated word boundaries vs Kokoro's native timings on the same audio.
   * Returns the mean absolute boundary error in milliseconds.
   */
  async estimateError(choice: BenchmarkCandidate, voice: string, sentences: string[]) {
    const h = await openEngine(choice);
    try {
      const errors: number[] = [];
      for (const text of sentences) {
        const r = await h.engine.synthesize({ text, voiceId: voice, speed: 1, lang: 'en' });
        const native = r.words ?? [];
        const words = segmentWords(text).map((w) => ({ start: w.start, end: w.end }));
        if (!native.length || native.length !== words.length) continue;
        const voiced = trimSilence(r.pcm, r.sampleRate, { marginMs: 0 });
        const v0 = voiced.trimmedStart / r.sampleRate;
        const v1 = (r.pcm.length - voiced.trimmedEnd) / r.sampleRate;
        // The player clamps timings to the speech region, so compare there.
        const clamp = (x: number) => Math.min(Math.max(x, v0), v1);
        const clamped = native.map((w) => ({ ...w, start: clamp(w.start), end: clamp(w.end) }));
        const est = estimateTimings({
          spoken: text,
          words,
          voicedStart: voiced.trimmedStart / r.sampleRate,
          voicedEnd: (r.pcm.length - voiced.trimmedEnd) / r.sampleRate,
          pcm: r.pcm,
          sampleRate: r.sampleRate,
        });
        errors.push(boundaryError(est, clamped) * 1000);
      }
      return {
        sentences: errors.length,
        meanMs: errors.reduce((a, b) => a + b, 0) / Math.max(1, errors.length),
        p90Ms: [...errors].sort((a, b) => a - b)[Math.floor(errors.length * 0.9)] ?? 0,
      };
    } finally {
      h.terminate();
    }
  },
  /** Raw material for tuning the estimator offline: native timings, voiced region, silent gaps. */
  async timingData(choice: BenchmarkCandidate, voice: string, sentences: string[]) {
    const { silentGaps } = await import('@/core/audio/dsp');
    const h = await openEngine(choice);
    try {
      const out = [];
      for (const text of sentences) {
        const r = await h.engine.synthesize({ text, voiceId: voice, speed: 1, lang: 'en' });
        const voiced = trimSilence(r.pcm, r.sampleRate, { marginMs: 0 });
        out.push({
          text,
          words: segmentWords(text).map((w) => ({ start: w.start, end: w.end })),
          native: r.words ?? [],
          voicedStart: voiced.trimmedStart / r.sampleRate,
          voicedEnd: (r.pcm.length - voiced.trimmedEnd) / r.sampleRate,
          gaps: silentGaps(r.pcm, r.sampleRate, 40),
        });
      }
      return out;
    } finally {
      h.terminate();
    }
  },
  benchmark: (c: BenchmarkCandidate) => benchmarkCandidate(c),
  setVoice: (voice: VoiceChoice) => saveSettings({ voice }),
};
