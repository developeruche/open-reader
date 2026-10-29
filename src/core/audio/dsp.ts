/** Pure audio post-processing (PLAN.md §5.4.1). All functions return new arrays. */

export const dbToAmp = (db: number) => 10 ** (db / 20);
export const ampToDb = (a: number) => (a > 0 ? 20 * Math.log10(a) : -Infinity);

export function rms(pcm: Float32Array, from = 0, to = pcm.length): number {
  let sum = 0;
  const n = Math.max(0, to - from);
  for (let i = from; i < to; i++) sum += (pcm[i] ?? 0) ** 2;
  return n ? Math.sqrt(sum / n) : 0;
}

export function peak(pcm: Float32Array): number {
  let p = 0;
  for (const v of pcm) p = Math.max(p, Math.abs(v));
  return p;
}

export interface TrimOptions {
  thresholdDb?: number;
  marginMs?: number;
  /** Analysis frame. */
  frameMs?: number;
}

export interface TrimResult {
  pcm: Float32Array;
  /** Samples removed from the start (word timings shift by this). */
  trimmedStart: number;
  trimmedEnd: number;
}

/** Trims leading/trailing silence below `thresholdDb` (frame RMS), keeping `marginMs` of each. */
export function trimSilence(
  pcm: Float32Array,
  sampleRate: number,
  o: TrimOptions = {},
): TrimResult {
  const threshold = dbToAmp(o.thresholdDb ?? -40);
  const frame = Math.max(1, Math.round(((o.frameMs ?? 10) * sampleRate) / 1000));
  const margin = Math.round(((o.marginMs ?? 30) * sampleRate) / 1000);
  let first = -1;
  let last = -1;
  for (let f = 0; f * frame < pcm.length; f++) {
    const s = f * frame;
    if (rms(pcm, s, Math.min(pcm.length, s + frame)) >= threshold) {
      if (first < 0) first = s;
      last = Math.min(pcm.length, s + frame);
    }
  }
  if (first < 0) return { pcm: new Float32Array(0), trimmedStart: pcm.length, trimmedEnd: 0 };
  const start = Math.max(0, first - margin);
  const end = Math.min(pcm.length, last + margin);
  return { pcm: pcm.slice(start, end), trimmedStart: start, trimmedEnd: pcm.length - end };
}

export interface LoudnessOptions {
  targetRmsDb?: number;
  peakCeilingDb?: number;
}

/** Gain toward an RMS target, limited so the peak stays under the ceiling. Returns the gain applied. */
export function normalizeLoudness(
  pcm: Float32Array,
  o: LoudnessOptions = {},
): { pcm: Float32Array; gain: number } {
  const r = rms(pcm);
  const p = peak(pcm);
  if (r === 0 || p === 0) return { pcm: pcm.slice(), gain: 1 };
  let gain = dbToAmp(o.targetRmsDb ?? -20) / r;
  gain = Math.min(gain, dbToAmp(o.peakCeilingDb ?? -1.5) / p);
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) out[i] = (pcm[i] ?? 0) * gain;
  return { pcm: out, gain };
}

/** Appends `seconds` of silence. */
export function padEnd(pcm: Float32Array, sampleRate: number, seconds: number): Float32Array {
  const extra = Math.max(0, Math.round(seconds * sampleRate));
  const out = new Float32Array(pcm.length + extra);
  out.set(pcm);
  return out;
}

/** Linear resampling (adequate for speech export and level analysis, not for playback). */
export function resampleLinear(pcm: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return pcm.slice();
  const n = Math.round((pcm.length * to) / from);
  const out = new Float32Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const x = i * ratio;
    const i0 = Math.floor(x);
    const t = x - i0;
    out[i] = (pcm[i0] ?? 0) * (1 - t) + (pcm[Math.min(i0 + 1, pcm.length - 1)] ?? 0) * t;
  }
  return out;
}

/** Silent gaps (≥ minGapMs, frame RMS below threshold) as [startSec, endSec]. */
export function silentGaps(
  pcm: Float32Array,
  sampleRate: number,
  minGapMs = 80,
  thresholdDb = -40,
  frameMs = 10,
): [number, number][] {
  const frame = Math.max(1, Math.round((frameMs * sampleRate) / 1000));
  const th = dbToAmp(thresholdDb);
  const gaps: [number, number][] = [];
  let runStart = -1;
  const frames = Math.ceil(pcm.length / frame);
  for (let f = 0; f <= frames; f++) {
    const silent = f < frames && rms(pcm, f * frame, Math.min(pcm.length, (f + 1) * frame)) < th;
    if (silent && runStart < 0) runStart = f;
    if (!silent && runStart >= 0) {
      if ((f - runStart) * frameMs >= minGapMs)
        gaps.push([(runStart * frame) / sampleRate, Math.min(pcm.length, f * frame) / sampleRate]);
      runStart = -1;
    }
  }
  return gaps;
}
