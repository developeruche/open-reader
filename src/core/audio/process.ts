/** Post-processing of one synthesized segment: trim → loudness → pause, with timings kept in sync. */
import {
  normalizeLoudness,
  padEnd,
  trimSilence,
  type LoudnessOptions,
  type TrimOptions,
} from './dsp';
import { monotonic, shiftTimings, type WordTiming } from './timing';

export interface ProcessedAudio {
  pcm: Float32Array;
  sampleRate: number;
  /** Media-time word timings (seconds from the start of `pcm`). */
  words: WordTiming[];
  /** Total duration including the trailing pause. */
  duration: number;
  /** Where speech ends and the structural pause begins. */
  speechEnd: number;
  /** Live engines (system voices) speak this text instead of playing `pcm`. */
  utterance?: { text: string; voice: string; lang: string };
}

export interface ProcessOptions {
  pauseAfter: number;
  trim?: TrimOptions;
  loudness?: LoudnessOptions | false;
}

export function postProcess(
  pcm: Float32Array,
  sampleRate: number,
  words: readonly WordTiming[],
  o: ProcessOptions,
): ProcessedAudio {
  const t = trimSilence(pcm, sampleRate, o.trim);
  const speechEnd = t.pcm.length / sampleRate;
  const shifted = shiftTimings(monotonic(words), -t.trimmedStart / sampleRate, speechEnd);
  const loud = o.loudness === false ? t.pcm : normalizeLoudness(t.pcm, o.loudness).pcm;
  const out = padEnd(loud, sampleRate, o.pauseAfter);
  return { pcm: out, sampleRate, words: shifted, duration: out.length / sampleRate, speechEnd };
}
