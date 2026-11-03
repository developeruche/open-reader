/**
 * Model management for extension pages (options, onboarding): OPFS downloads, verification and
 * the §6.4 benchmark. Downloads run in the page that started them and resume after interruption.
 */
import { ampToDb, rms } from '@/core/audio/dsp';
import {
  BENCHMARK_SENTENCES,
  chooseDefault,
  type BenchmarkCandidate,
  type BenchmarkReport,
  type BenchmarkResult,
} from '@/core/models/benchmark';
import { filesFor, ModelManager, modelDir } from '@/core/models/manager';
import type { ModelManifest } from '@/core/tts/registry';
import type { VoiceChoice } from '@/core/settings';
import { lexiconFrom, type StoredEntry } from '@/core/text/lexicon';
import { normalize } from '@/core/text/normalize';
import { openEngine, REGISTRY } from '@/engines/factory';
import { localStore } from '@/platform/kv';
import { OpfsStore, sha256Subtle } from '@/platform/opfs';

export const BENCHMARK_KEY = 'models.benchmark';

export function createModelManager(sourceBase?: string): ModelManager {
  return new ModelManager({
    store: new OpfsStore(),
    kv: localStore(),
    fetch: (url, init) => fetch(url, init),
    hash: sha256Subtle,
    // The offline pack (pnpm build:offline) bundles files at /models/<id>/<version>/…; tests pass
    // a local server instead. Missing bundled files fall back to the registry URL.
    localUrl: (m, f) =>
      sourceBase
        ? `${sourceBase}/${m.engine}/${f.path}`
        : `${location.origin}/${modelDir(m)}/${f.path}`,
  });
}

export async function gpuInfo(): Promise<BenchmarkReport['gpu']> {
  const gpu = (
    navigator as Navigator & {
      gpu?: {
        requestAdapter(): Promise<{ info?: { vendor?: string; architecture?: string } } | null>;
      };
    }
  ).gpu;
  if (!gpu) return { available: false };
  try {
    const a = await gpu.requestAdapter();
    return a
      ? { available: true, vendor: a.info?.vendor, architecture: a.info?.architecture }
      : { available: false };
  } catch {
    return { available: false };
  }
}

/** Synthesizes the reference sentences and measures real-time factor and first-audio latency. */
export async function benchmarkCandidate(
  c: BenchmarkCandidate,
  voice?: string,
): Promise<BenchmarkResult> {
  const manifest = REGISTRY.models.find((m) => m.id === c.modelId);
  let handle: Awaited<ReturnType<typeof openEngine>> | undefined;
  try {
    handle = await openEngine({ engineId: c.engineId, modelId: c.modelId, backend: c.backend });
    const v = voice ?? manifest?.defaultVoice ?? 'default';
    await handle.engine.synthesize({ text: 'Warm up.', voiceId: v, speed: 1, lang: 'en' });
    let synth = 0;
    let audio = 0;
    let first = 0;
    let loud = -Infinity;
    for (const [i, text] of BENCHMARK_SENTENCES.entries()) {
      const t0 = performance.now();
      const r = await handle.engine.synthesize({ text, voiceId: v, speed: 1, lang: 'en' });
      const ms = performance.now() - t0;
      if (i === 0) first = ms;
      synth += ms / 1000;
      audio += r.pcm.length / r.sampleRate;
      loud = Math.max(loud, ampToDb(rms(r.pcm)));
    }
    return {
      ...c,
      rtf: +(synth / Math.max(audio, 1e-6)).toFixed(3),
      firstAudioMs: Math.round(first),
      audible: loud > -50,
    };
  } catch (e) {
    return {
      ...c,
      rtf: Infinity,
      firstAudioMs: 0,
      audible: false,
      error: e instanceof Error ? e.message : String(e),
    };
  } finally {
    handle?.terminate();
  }
}

/** Benchmarks every installed candidate and records the choice (§6.4). */
export async function runBenchmark(manager: ModelManager): Promise<BenchmarkReport> {
  const gpu = await gpuInfo();
  const installed = await manager.installed();
  const candidates: BenchmarkCandidate[] = [];
  for (const m of REGISTRY.models) {
    const i = installed[m.id];
    if (!i || (m.engine !== 'kokoro' && m.engine !== 'piper')) continue;
    for (const backend of ['webgpu', 'wasm'] as const) {
      if (backend === 'webgpu' && !gpu.available) continue;
      if (!filesFor(m, backend).every((f) => i.files.some((x) => x.path === f.path))) continue;
      candidates.push({ engineId: m.engine, modelId: m.id, backend });
    }
  }
  const results: BenchmarkResult[] = [];
  for (const c of candidates) results.push(await benchmarkCandidate(c));
  const report: BenchmarkReport = { at: Date.now(), gpu, results, choice: chooseDefault(results) };
  await localStore().set(BENCHMARK_KEY, report);
  return report;
}

export function defaultBackendFor(model: ModelManifest, gpuAvailable: boolean): 'webgpu' | 'wasm' {
  return gpuAvailable && model.caps.backends.includes('webgpu') ? 'webgpu' : 'wasm';
}

let sampleHandle: Awaited<ReturnType<typeof openEngine>> | undefined;
let sampleAudio: HTMLAudioElement | undefined;

export const SAMPLE_TEXT =
  'Open Reader reads web pages and documents aloud, with a cursor that follows every word, so you can look away and find your place again.';

/** Synthesizes and plays a short sample locally (no remote sample files). */
export async function playSample(
  model: ModelManifest,
  voiceId: string,
  backend: 'webgpu' | 'wasm',
  text = SAMPLE_TEXT,
): Promise<void> {
  if (!sampleHandle || sampleHandle.modelId !== model.id || sampleHandle.backend !== backend) {
    sampleHandle?.terminate();
    sampleHandle = await openEngine({ engineId: model.engine, modelId: model.id, backend });
  }
  const r = await sampleHandle.engine.synthesize({
    text,
    voiceId,
    speed: 1,
    lang: 'en',
  });
  const { encodeWav } = await import('@/core/audio/wav');
  sampleAudio?.pause();
  sampleAudio = new Audio(
    URL.createObjectURL(
      new Blob([encodeWav(r.pcm, r.sampleRate).buffer as ArrayBuffer], { type: 'audio/wav' }),
    ),
  );
  await sampleAudio.play();
}

/**
 * The pronunciation editor's Test button: "Say <word>." through the real normalizer with the
 * entry applied, in the current voice (system voices speak through chrome.tts).
 */
export async function testPronunciation(
  entry: StoredEntry,
  voice: VoiceChoice | null,
  speakSystem: (text: string) => void,
): Promise<string> {
  const engineId = voice?.engineId ?? 'system';
  const lexicon = lexiconFrom({ user: [entry], packs: [] }, engineId);
  const sample = entry.regex ? entry.say : `Say ${entry.match}.`;
  const spoken = normalize(sample, { lexicon }).spoken;
  const model = REGISTRY.models.find(
    (m) => m.id === voice?.modelId || (voice && m.engine === voice.engineId),
  );
  if (!voice || engineId === 'system' || !model) {
    speakSystem(spoken);
    return spoken;
  }
  const gpu = !!(navigator as { gpu?: unknown }).gpu;
  await playSample(model, voice.voice, voice.backend ?? (gpu ? 'webgpu' : 'wasm'), spoken);
  return spoken;
}
