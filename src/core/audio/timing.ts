/** Word timings in media seconds, and estimation for engines without native timings (§5.4.4). */
import { silentGaps } from './dsp';

/** Seconds, spoken-text character offsets (PLAN.md §5.3). */
export interface WordTiming {
  charStart: number;
  charEnd: number;
  start: number;
  end: number;
}

/** Shifts timings by `offset` seconds and clamps them into [0, duration]. */
export function shiftTimings(
  words: readonly WordTiming[],
  offset: number,
  duration: number,
): WordTiming[] {
  const clamp = (t: number) => Math.max(0, Math.min(duration, t));
  return words.map((w) => ({ ...w, start: clamp(w.start + offset), end: clamp(w.end + offset) }));
}

/** Forces start ≤ end and non-decreasing starts (engines occasionally emit tiny overlaps). */
export function monotonic(words: readonly WordTiming[]): WordTiming[] {
  let prev = 0;
  return words.map((w) => {
    const start = Math.max(prev, w.start);
    const end = Math.max(start, w.end);
    prev = start;
    return { ...w, start, end };
  });
}

/** Rough syllable count; good enough to weight durations. */
export function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!w) return 1;
  if (/^\d+$/.test(w)) return Math.max(1, w.length * 1.5);
  if (w.length <= 2 && /^[a-z]+$/.test(word) && word === word.toUpperCase()) return 1;
  const groups = w.replace(/e$/, '').match(/[aeiouy]+/g);
  return Math.max(1, groups?.length ?? 1);
}

const PUNCT_WEIGHT: Record<string, number> = {
  ',': 0.8,
  ';': 1,
  ':': 1,
  '.': 1.2,
  '!': 1.2,
  '?': 1.2,
  '—': 0.8,
  '–': 0.6,
};

export interface EstimateInput {
  spoken: string;
  /** Word spans in spoken offsets. */
  words: { start: number; end: number }[];
  /** Voiced region of the audio, seconds. */
  voicedStart: number;
  voicedEnd: number;
  /** Optional audio to snap boundaries to silent gaps. */
  pcm?: Float32Array;
  sampleRate?: number;
}

/**
 * Distributes the voiced duration over words by syllable weight plus punctuation pause weight,
 * then snaps the end of each word followed by punctuation to the nearest silent gap (§5.4.4).
 */
export function estimateTimings(input: EstimateInput): WordTiming[] {
  const { spoken, words, voicedStart, voicedEnd } = input;
  if (!words.length) return [];
  const weights = words.map((w, i) => {
    const next = words[i + 1]?.start ?? spoken.length;
    const between = spoken.slice(w.end, next);
    const pause = [...between].reduce((a, c) => a + (PUNCT_WEIGHT[c] ?? 0), 0);
    return { word: syllables(spoken.slice(w.start, w.end)), pause };
  });
  const total = weights.reduce((a, w) => a + w.word + w.pause, 0);
  const span = Math.max(0, voicedEnd - voicedStart);
  let t = voicedStart;
  const out: WordTiming[] = words.map((w, i) => {
    const wt = weights[i] ?? { word: 1, pause: 0 };
    const start = t;
    const end = start + (span * wt.word) / total;
    t = end + (span * wt.pause) / total;
    return { charStart: w.start, charEnd: w.end, start, end };
  });
  if (input.pcm && input.sampleRate) {
    const gaps = silentGaps(input.pcm, input.sampleRate);
    const maxShift = 0.25;
    out.forEach((w, i) => {
      if (!weights[i]?.pause || i === out.length - 1) return;
      let best: [number, number] | undefined;
      for (const g of gaps)
        if (!best || Math.abs(g[0] - w.end) < Math.abs(best[0] - w.end)) best = g;
      if (!best || Math.abs(best[0] - w.end) > maxShift) return;
      w.end = Math.max(w.start + 0.02, best[0]);
      const next = out[i + 1];
      if (next) next.start = Math.max(w.end, best[1]);
    });
  }
  return monotonic(out);
}

/** Index of the word playing at media time `t` (last word started at or before t), or -1. */
export function wordAt(words: readonly WordTiming[], t: number): number {
  let lo = 0;
  let hi = words.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if ((words[mid]?.start ?? Infinity) <= t) {
      ans = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return ans;
}

/** Mean absolute boundary error (seconds) between two timing lists of equal length. */
export function boundaryError(a: readonly WordTiming[], b: readonly WordTiming[]): number {
  const n = Math.min(a.length, b.length);
  if (!n) return 0;
  let sum = 0;
  for (let i = 0; i < n; i++)
    sum +=
      (Math.abs((a[i]?.start ?? 0) - (b[i]?.start ?? 0)) +
        Math.abs((a[i]?.end ?? 0) - (b[i]?.end ?? 0))) /
      2;
  return sum / n;
}
