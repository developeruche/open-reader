/** Spoken segments (PLAN.md §5.2.6): what an engine synthesizes, with its map back to the block. */
import type { Block, BlockType, Sentence } from '../document/model';
import type { OffsetMap } from './offsetMap';
import { mapRange } from './offsetMap';
import { normalize, type NormalizeOptions } from './normalize';
import { pauseAfter, type PacingPreset } from './pacing';
import { clauseBoundaries, segmentWords } from './segment';

export interface SpokenWord {
  spokenStart: number;
  spokenEnd: number;
  /** Display range in block.text (absolute). */
  displayStart: number;
  displayEnd: number;
  /** Index into sentence.words of the first display word covered, or -1 if none. */
  sentenceWord: number;
}

export interface SpokenSegment {
  /** `${sentenceId}#${part}` */
  id: string;
  sentenceId: string;
  blockId: string;
  part: number;
  parts: number;
  spoken: string;
  /** Spoken offsets → absolute block.text offsets. */
  map: OffsetMap;
  words: SpokenWord[];
  /** Seconds of silence after this segment. */
  pauseAfter: number;
}

export interface SegmentContext {
  block: Block;
  sentence: Sentence;
  lastInBlock: boolean;
  nextBlockType?: BlockType;
  pacing?: PacingPreset;
  normalize?: NormalizeOptions;
  /** Engine limit in spoken characters. */
  maxChars?: number;
  /** First segment of a session: split long sentences early so audio starts sooner. */
  fastStart?: boolean;
  /** Replace the sentence with this text (skipped-code announcement). */
  sayInstead?: string;
}

/**
 * Fast start (§5.2.6, ADR 0017): a first sentence longer than FAST_START_MIN is split so its first
 * part has at most FAST_START_CHARS. Kokoro on WebGPU costs ≈ 200 ms + 6 ms per character, so 60
 * characters keep warm first audio under 800 ms (the plan's 120 measured 790–850 ms).
 */
export const FAST_START_CHARS = 60;
export const FAST_START_MIN = 70;
const MIN_PART = 20;

/** Splits [0, len) of `spoken` into parts of at most `max` chars, preferring clause boundaries. */
export function splitPoints(spoken: string, max: number): number[] {
  const cuts: number[] = [];
  let from = 0;
  while (spoken.length - from > max) {
    const limit = from + max;
    const clauses = clauseBoundaries(spoken, from, limit).filter((c) => c - from >= MIN_PART);
    let cut = clauses.at(-1);
    if (cut === undefined) {
      const sp = spoken.lastIndexOf(' ', limit);
      cut = sp > from + MIN_PART ? sp : limit;
    }
    cuts.push(cut);
    from = cut;
    while (spoken[from] === ' ') from++;
  }
  return cuts;
}

function sliceMap(map: OffsetMap, from: number, to: number): OffsetMap {
  return {
    start: map.start.slice(from, to),
    end: map.end.slice(from, to),
    sourceLength: map.sourceLength,
  };
}

function spokenWords(spoken: string, map: OffsetMap, sentence: Sentence): SpokenWord[] {
  return segmentWords(spoken).map((w) => {
    const [ds, de] = mapRange(map, w.start, w.end);
    const sentenceWord = sentence.words.findIndex(
      (x) => x.end > ds && x.start < Math.max(de, ds + 1),
    );
    return {
      spokenStart: w.start,
      spokenEnd: w.end,
      displayStart: ds,
      displayEnd: de,
      sentenceWord,
    };
  });
}

export function buildSegments(ctx: SegmentContext): SpokenSegment[] {
  const { block, sentence } = ctx;
  const display = block.text.slice(sentence.start, sentence.end);
  let spoken: string;
  let map: OffsetMap;
  if (ctx.sayInstead !== undefined) {
    spoken = ctx.sayInstead;
    const n = spoken.length;
    map = {
      start: new Int32Array(n).fill(sentence.start),
      end: new Int32Array(n).fill(sentence.end),
      sourceLength: block.text.length,
    };
  } else {
    const marks = (block.marks ?? [])
      .filter((m) => m.end > sentence.start && m.start < sentence.end)
      .map((m) => ({
        ...m,
        start: Math.max(0, m.start - sentence.start),
        end: Math.min(display.length, m.end - sentence.start),
      }));
    const r = normalize(display, { ...ctx.normalize, marks });
    spoken = r.spoken;
    const start = r.map.start.map((x) => x + sentence.start);
    const end = r.map.end.map((x) => x + sentence.start);
    map = { start, end, sourceLength: block.text.length };
  }
  if (spoken.trim() === '') return [];

  const maxChars = ctx.maxChars ?? Infinity;
  let cuts = Number.isFinite(maxChars) ? splitPoints(spoken, maxChars) : [];
  // Fast start: split a long first sentence, at a clause boundary when there is one early enough.
  if (ctx.fastStart && spoken.length > FAST_START_MIN) {
    const first = clauseBoundaries(spoken).find(
      (c) => c >= MIN_PART && c <= Math.min(maxChars, FAST_START_CHARS),
    );
    const cut = first ?? splitPoints(spoken, Math.min(maxChars, FAST_START_CHARS))[0];
    if (cut !== undefined) {
      const restStart = cut + (spoken.slice(cut).length - spoken.slice(cut).trimStart().length);
      cuts = [cut, ...splitPoints(spoken.slice(restStart), maxChars).map((c) => c + restStart)];
    }
  }
  const bounds = [0, ...cuts, spoken.length];
  const parts: { s: number; e: number }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    let s = bounds[i] ?? 0;
    let e = bounds[i + 1] ?? spoken.length;
    while (s < e && spoken[s] === ' ') s++;
    while (e > s && spoken[e - 1] === ' ') e--;
    if (e > s) parts.push({ s, e });
  }
  const pause = pauseAfter(
    { blockType: block.type, lastInBlock: ctx.lastInBlock, nextBlockType: ctx.nextBlockType },
    ctx.pacing,
  );
  return parts.map((p, i) => {
    const text = spoken.slice(p.s, p.e);
    const m = sliceMap(map, p.s, p.e);
    return {
      id: `${sentence.id}#${i}`,
      sentenceId: sentence.id,
      blockId: block.id,
      part: i,
      parts: parts.length,
      spoken: text,
      map: m,
      words: spokenWords(text, m, sentence),
      pauseAfter: i === parts.length - 1 ? pause : 0,
    };
  });
}
