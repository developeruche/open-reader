/** Word timings from Kokoro's per-token durations (HeadTTS approach, PLAN.md §6.2). */
import type { WordTiming } from '@/core/audio/timing';

/** Kokoro durations are in frames of 25 ms (24 kHz, hop 600). */
export const FRAME_RATE = 40;

export interface G2PWord {
  /** Character range in the input text. */
  charStart: number;
  charEnd: number;
  /** Phoneme index range [start, end). */
  phStart: number;
  phEnd: number;
}

/** Cumulative token start times (seconds); times[k] is when token k starts, times[n] the end. */
export function tokenTimes(durations: ArrayLike<number | bigint>): number[] {
  const times = [0];
  for (let i = 0; i < durations.length; i++)
    times.push((times[i] ?? 0) + Number(durations[i]) / FRAME_RATE);
  return times;
}

export function wordTimings(words: G2PWord[], tokenOf: Int32Array, times: number[]): WordTiming[] {
  const at = (ph: number) => times[tokenOf[Math.min(ph, tokenOf.length - 1)] ?? 0] ?? 0;
  return words.map((w) => ({
    charStart: w.charStart,
    charEnd: w.charEnd,
    start: at(w.phStart),
    end: at(w.phEnd),
  }));
}

/** Converts HeadTTS word strings (which concatenate to the input) into char ranges. */
export function g2pWords(
  input: string,
  words: string[],
  wtimes: number[],
  wdurations: number[],
): G2PWord[] {
  const out: G2PWord[] = [];
  let pos = 0;
  words.forEach((w, i) => {
    const start = pos;
    pos += w.length;
    const lead = w.length - w.trimStart().length;
    const core = w.trim();
    if (!core) return;
    out.push({
      charStart: start + lead,
      charEnd: start + lead + core.length,
      phStart: wtimes[i] ?? 0,
      phEnd: wdurations[i] ?? 0,
    });
  });
  // Defensive: if HeadTTS ever rewrites words, fall back to searching the input in order.
  if (words.join('') !== input) {
    let cursor = 0;
    for (const [i, w] of out.entries()) {
      const core = (words[i] ?? '').trim();
      const found = input.indexOf(core, cursor);
      if (found >= 0) {
        w.charStart = found;
        w.charEnd = found + core.length;
        cursor = w.charEnd;
      }
    }
  }
  return out;
}
