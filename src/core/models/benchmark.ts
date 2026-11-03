/** Backend detection and automatic engine selection (PLAN.md §6.4). */

export interface BenchmarkCandidate {
  engineId: 'kokoro' | 'piper';
  modelId: string;
  backend: 'webgpu' | 'wasm';
}

export interface BenchmarkResult extends BenchmarkCandidate {
  /** Synthesis seconds per audio second (lower is faster). */
  rtf: number;
  firstAudioMs: number;
  /** Output had audible signal (rejects silent variants such as Kokoro fp16, ADR 0003). */
  audible: boolean;
  error?: string;
}

export interface BenchmarkReport {
  at: number;
  gpu: { available: boolean; vendor?: string; architecture?: string };
  results: BenchmarkResult[];
  choice: BenchmarkCandidate | null;
}

export const RTF_GOOD = 0.6;
/** Sustained RTF above this starves playback; suggest a faster voice (§6.4.4). */
export const RTF_STARVING = 0.9;

export const BENCHMARK_SENTENCES = [
  'Open Reader reads web pages and documents aloud.',
  'A partially signed Bitcoin transaction lets several wallets cooperate before broadcasting.',
  'The cursor follows the voice, word by word, across every page.',
];

const ok = (r: BenchmarkResult | undefined) => !!r && !r.error && r.audible && r.rtf <= RTF_GOOD;

/**
 * Kokoro on WebGPU if RTF ≤ 0.6; otherwise Piper lessac-high if RTF ≤ 0.6, or another Piper voice
 * that fast (store builds have only LJSpeech); otherwise Piper lessac-medium. Kokoro WASM is used
 * when it is fast enough and no Piper result exists.
 */
export function chooseDefault(results: BenchmarkResult[]): BenchmarkCandidate | null {
  const find = (f: (r: BenchmarkResult) => boolean) =>
    results.filter(f).sort((a, b) => a.rtf - b.rtf)[0];
  const pick = (r: BenchmarkResult | undefined): BenchmarkCandidate | null =>
    r ? { engineId: r.engineId, modelId: r.modelId, backend: r.backend } : null;
  const kokoroGpu = find((r) => r.engineId === 'kokoro' && r.backend === 'webgpu');
  if (ok(kokoroGpu)) return pick(kokoroGpu);
  const high =
    find((r) => r.engineId === 'piper' && r.modelId.includes('lessac-high') && ok(r)) ??
    find((r) => r.engineId === 'piper' && ok(r));
  if (high) return pick(high);
  const medium = find(
    (r) => r.engineId === 'piper' && r.modelId.includes('lessac-medium') && !r.error && r.audible,
  );
  if (medium) return pick(medium);
  const kokoroWasm = find((r) => r.engineId === 'kokoro' && r.backend === 'wasm' && ok(r));
  if (kokoroWasm) return pick(kokoroWasm);
  return pick(find((r) => !r.error && r.audible));
}

/** "Kokoro · WebGPU · 9.4× real time" */
export function describeResult(r: Pick<BenchmarkResult, 'engineId' | 'backend' | 'rtf'>): string {
  const engine = r.engineId === 'kokoro' ? 'Kokoro' : 'Piper';
  const backend = r.backend === 'webgpu' ? 'WebGPU' : 'WASM';
  const speed = r.rtf > 0 ? `${(1 / r.rtf).toFixed(1)}× real time` : '';
  return [engine, backend, speed].filter(Boolean).join(' · ');
}

/** Rolling RTF monitor: true once RTF stayed above the starving threshold for `windowMs`. */
export class RtfMonitor {
  private since: number | null = null;
  constructor(private readonly windowMs = 30_000) {}
  sample(rtf: number, now: number): boolean {
    if (rtf <= RTF_STARVING) {
      this.since = null;
      return false;
    }
    this.since ??= now;
    return now - this.since >= this.windowMs;
  }
}
