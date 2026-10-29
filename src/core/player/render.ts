/**
 * Segment planning and rendering shared by the player and audiobook export, so an export sounds
 * exactly like playback: same segments, pauses, lexicon, skip rules, cache and post-processing.
 */
import { trimSilence } from '../audio/dsp';
import { postProcess, type ProcessedAudio } from '../audio/process';
import { estimateTimings, type WordTiming } from '../audio/timing';
import { floatToInt16, int16ToFloat } from '../audio/wav';
import type { BlockType } from '../document/model';
import type { Navigator } from '../document/positions';
import type { Lexicon } from '../text/lexicon';
import { NORMALIZER_VERSION } from '../text/normalize';
import type { PacingPreset } from '../text/pacing';
import { buildSegments, type SpokenSegment } from '../text/segments';
import { inlineSkips, skipAnnouncement, type SkipRules } from '../text/skip';
import type { RenderEngine, SynthesisResult } from '../tts/engine';
import { cacheKey, type SynthesisCache } from './cache';

export interface PlanOptions {
  pacing: PacingPreset;
  lexicon: Lexicon;
  skipRules: SkipRules;
  maxChars: number;
  fastStart?: boolean;
}

/** The spoken segments of one sentence (none when it is skipped). */
export function sentenceSegments(
  nav: Navigator,
  sentence: number,
  o: PlanOptions,
): SpokenSegment[] {
  const ref = nav.at(sentence);
  if (!ref) return [];
  const nextRef = nav.at(sentence + 1);
  const lastInBlock = !nextRef || nextRef.blockIndex !== ref.blockIndex;
  const nextBlockType: BlockType | undefined = lastInBlock ? nextRef?.block.type : ref.block.type;
  return buildSegments({
    block: ref.block,
    sentence: ref.sentence,
    lastInBlock,
    nextBlockType,
    pacing: o.pacing,
    normalize: { lexicon: o.lexicon, skips: inlineSkips(o.skipRules) },
    maxChars: o.maxChars,
    fastStart: o.fastStart ?? false,
    sayInstead: skipAnnouncement(ref.block, o.skipRules),
  });
}

export interface RenderContext {
  engine: RenderEngine;
  model: { modelId: string; version: string };
  cache?: SynthesisCache;
  lang: string;
  now(): number;
}

export interface Rendered {
  audio: ProcessedAudio;
  fromCache: boolean;
  /** Wall-clock synthesis time and audio length, when the engine ran (for RTF). */
  synth?: { seconds: number; audioSeconds: number };
}

/** Synthesizes (or reads from the cache) and post-processes one segment. */
export async function renderSegment(
  ctx: RenderContext,
  segment: SpokenSegment,
  voice: string,
  modelSpeed: number,
  signal?: AbortSignal,
): Promise<Rendered> {
  const engine = ctx.engine;
  const ck = cacheKey({
    engineId: engine.id,
    modelId: ctx.model.modelId,
    modelVersion: ctx.model.version,
    voiceId: voice,
    speed: modelSpeed,
    normalizerVersion: NORMALIZER_VERSION,
    spokenText: segment.spoken,
  });
  let result: SynthesisResult;
  let synth: Rendered['synth'];
  const hit = await ctx.cache?.get(ck);
  if (hit) {
    result = { pcm: int16ToFloat(hit.pcm), sampleRate: hit.sampleRate, words: hit.words };
  } else {
    const t0 = ctx.now();
    result = await engine.synthesize(
      { text: segment.spoken, voiceId: voice, speed: modelSpeed, lang: ctx.lang },
      signal,
    );
    synth = {
      seconds: (ctx.now() - t0) / 1000,
      audioSeconds: result.pcm.length / result.sampleRate,
    };
    void ctx.cache?.put(ck, {
      pcm: floatToInt16(result.pcm),
      sampleRate: result.sampleRate,
      words: result.words,
    });
  }
  const raw = result.words ?? estimate(segment, result);
  const audio = postProcess(result.pcm, result.sampleRate, raw, {
    pauseAfter: segment.pauseAfter / modelSpeed,
  });
  return { audio, fromCache: !!hit, ...(synth ? { synth } : {}) };
}

function estimate(segment: SpokenSegment, r: SynthesisResult): WordTiming[] {
  const words = segment.words.map((w) => ({ start: w.spokenStart, end: w.spokenEnd }));
  // Spread words over the voiced region only, not the engine's leading/trailing silence.
  const voiced = trimSilence(r.pcm, r.sampleRate, { marginMs: 0 });
  return estimateTimings({
    spoken: segment.spoken,
    words,
    voicedStart: voiced.trimmedStart / r.sampleRate,
    voicedEnd: (r.pcm.length - voiced.trimmedEnd) / r.sampleRate,
    pcm: r.pcm,
    sampleRate: r.sampleRate,
  });
}
