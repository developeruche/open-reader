/**
 * Audiobook export (PLAN.md M11), run inside an engine host. Pass 1 renders every segment exactly
 * as playback would (same planner, renderer and cache), stores 16-bit PCM in a scratch file and
 * meters loudness and true peak. Pass 2 applies the gain for −17 LUFS, limits peaks to −1.5 dBTP
 * and writes MP3 (64 kbps mono) or WAV with ID3v2.3 chapters, one per heading.
 */
import { id3v23, MAX_CHAPTERS, type Chapter } from '@/core/audio/id3';
import {
  EXPORT_LUFS,
  EXPORT_TRUE_PEAK_DB,
  gainFor,
  LoudnessMeter,
  PeakLimiter,
  TruePeakMeter,
} from '@/core/audio/loudness';
import { floatToInt16, int16ToFloat, wavHeader, wavId3Chunk } from '@/core/audio/wav';
import type { ReadingDocument } from '@/core/document/model';
import { Navigator } from '@/core/document/positions';
import { renderSegment, sentenceSegments, type RenderContext } from '@/core/player/render';
import type { Lexicon } from '@/core/text/lexicon';
import type { PacingPreset } from '@/core/text/pacing';
import type { SkipRules } from '@/core/text/skip';
import { AbortError } from '@/core/tts/engine';

export type ExportFormat = 'mp3' | 'wav';
export const MP3_KBPS = 64;
/**
 * 64 kbps MP3 measures 0.5 LU quieter than its source (its low-pass drops highs that K-weighting
 * counts; FFmpeg ebur128 on Kokoro speech), so MP3 exports aim that much higher before encoding.
 */
export const MP3_LOUDNESS_LOSS = 0.5;
/** LAME's encoder delay plus the decoder delay: decoded MP3 audio starts this many samples late. */
export const MP3_DELAY_SAMPLES = 1105;

export interface ExportStore {
  appender(
    path: string,
  ): Promise<{ write(chunk: Uint8Array): Promise<void>; close(): Promise<void> }>;
  /** Bytes [start, end) of a written file. */
  slice(path: string, start: number, end: number): Promise<ArrayBuffer>;
  remove(path: string): Promise<void>;
}

export interface Mp3Encoder {
  /** Returns encoded bytes; the caller copies them before the next call. */
  encode(pcm: Float32Array): Uint8Array;
  finalize(): Uint8Array;
}

export interface ExportProgress {
  phase: 'render' | 'encode';
  done: number;
  total: number;
}

export interface ExportRequest {
  jobId: string;
  doc: ReadingDocument;
  format: ExportFormat;
  voice: string;
  pacing: PacingPreset;
  skipRules: SkipRules;
  lexicon: Lexicon;
  artist?: string;
}

export interface ExportDeps {
  render: RenderContext;
  store: ExportStore;
  mp3(sampleRate: number, kbps: number): Promise<Mp3Encoder>;
  onProgress?(p: ExportProgress): void;
}

export interface ExportResult {
  path: string;
  filename: string;
  bytes: number;
  /** Seconds of audio, equal to the sum of the playback plan's segment durations. */
  duration: number;
  chapters: Chapter[];
  lufs: number;
  truePeakDb: number;
}

const SCRATCH_CHUNK = 1 << 16; // samples per pass-2 read

/** "PSBTs, explained" → "PSBTs explained.mp3" (no path characters, at most 120 characters). */
export function exportFilename(title: string, format: ExportFormat): string {
  const base =
    title
      .replace(/[\\/:*?"<>|\p{Cc}]+/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 120) || 'Open Reader audiobook';
  return `${base}.${format}`;
}

/** Keeps at most 255 chapters (CTOC limit) by dropping deeper heading levels first. */
export function limitChapters(
  heads: (Chapter & { level: number })[],
  max = MAX_CHAPTERS,
): (Chapter & { level: number })[] {
  let level = Math.max(1, ...heads.map((h) => h.level));
  let kept = heads;
  while (kept.length > max && level > 1) {
    level--;
    kept = heads.filter((h) => h.level <= level || h.level === 0);
  }
  return kept.slice(0, max);
}

export async function runExport(
  req: ExportRequest,
  deps: ExportDeps,
  signal?: AbortSignal,
): Promise<ExportResult> {
  const check = () => {
    if (signal?.aborted) throw new AbortError();
  };
  const nav = new Navigator(req.doc, { announceSkippedCode: req.skipRules.announceSkippedCode });
  const plan = [];
  for (let s = 0; s < nav.length; s++)
    for (const segment of sentenceSegments(nav, s, {
      pacing: req.pacing,
      lexicon: req.lexicon,
      skipRules: req.skipRules,
      maxChars: deps.render.engine.caps.maxChars,
    }))
      plan.push({ segment, sentence: s });
  if (!plan.length) throw new Error('Nothing to export: every block is skipped.');

  const scratch = `exports/${req.jobId}.pcm`;
  const out = `exports/${req.jobId}.${req.format}`;
  let sampleRate = 0;
  let samples = 0;
  const heads: (Chapter & { level: number })[] = [];
  let lastBlock = -1;
  const meter: { lufs?: LoudnessMeter; tp: TruePeakMeter } = { tp: new TruePeakMeter() };
  try {
    // ── pass 1: render, meter, store ─────────────────────────────────────────
    const w = await deps.store.appender(scratch);
    try {
      for (const [i, { segment, sentence }] of plan.entries()) {
        check();
        const r = await renderSegment(deps.render, segment, req.voice, 1, signal);
        const a = r.audio;
        if (!sampleRate) {
          sampleRate = a.sampleRate;
          meter.lufs = new LoudnessMeter(sampleRate);
        } else if (a.sampleRate !== sampleRate)
          throw new Error(`Mixed sample rates (${sampleRate} and ${a.sampleRate} Hz)`);
        const ref = nav.at(sentence);
        if (ref && ref.blockIndex !== lastBlock) {
          lastBlock = ref.blockIndex;
          if (ref.block.type === 'heading')
            heads.push({
              title: ref.block.text,
              level: ref.block.level ?? 1,
              startMs: (samples / sampleRate) * 1000,
              endMs: 0,
            });
          else if (!heads.length && samples === 0)
            // Text before the first heading becomes a chapter named after the document.
            heads.push({ title: req.doc.title || 'Introduction', level: 0, startMs: 0, endMs: 0 });
        }
        meter.lufs?.push(a.pcm);
        meter.tp.push(a.pcm);
        const pcm16 = floatToInt16(a.pcm);
        await w.write(new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength));
        samples += a.pcm.length;
        deps.onProgress?.({ phase: 'render', done: i + 1, total: plan.length });
      }
    } finally {
      await w.close();
    }
    const totalMs = (samples / sampleRate) * 1000;
    // A leading document-title chapter only makes sense when real headings follow.
    const named = heads.filter((h) => h.level > 0).length ? heads : [];
    const kept = limitChapters(named);
    // Players decode MP3 with the encoder delay in front, so chapters move with the audio.
    const shift = req.format === 'mp3' ? (MP3_DELAY_SAMPLES / sampleRate) * 1000 : 0;
    const at = (ms: number) => Math.round(ms === 0 ? 0 : ms + shift);
    const chapters: Chapter[] = kept.map((h, i) => ({
      title: h.title,
      startMs: at(h.startMs),
      endMs: Math.round((kept[i + 1]?.startMs ?? totalMs) + shift),
    }));
    const tag = id3v23({
      title: req.doc.title || 'Open Reader audiobook',
      artist: req.artist,
      album: req.doc.title || undefined,
      chapters,
    });

    // ── pass 2: gain, limiter, encode ────────────────────────────────────────
    // 64 kbps MP3 overshoots inter-sample peaks by about 1.1 dB (FFmpeg ebur128 on Kokoro speech),
    // so its ceiling sits 1.5 dB under the target; WAV keeps a 0.5 dB margin for our meter.
    const ceiling = EXPORT_TRUE_PEAK_DB - (req.format === 'mp3' ? 1.5 : 0.5);
    const readChunk = async (at: number, g: number) => {
      const end = Math.min(samples, at + SCRATCH_CHUNK);
      const pcm = int16ToFloat(new Int16Array(await deps.store.slice(scratch, at * 2, end * 2)));
      for (let i = 0; i < pcm.length; i++) pcm[i] = (pcm[i] ?? 0) * g;
      return { pcm, end };
    };
    const target = EXPORT_LUFS + (req.format === 'mp3' ? MP3_LOUDNESS_LOSS : 0);
    // The limiter takes a little loudness off speech peaks: measure a dry run and make up for it.
    let gain = gainFor(meter.lufs?.integrated() ?? -Infinity, target);
    if (Number.isFinite(meter.lufs?.integrated() ?? -Infinity)) {
      const dry = new PeakLimiter(sampleRate, ceiling);
      const m = new LoudnessMeter(sampleRate);
      for (let at = 0; at < samples; at += SCRATCH_CHUNK) {
        check();
        m.push(dry.process((await readChunk(at, gain)).pcm));
      }
      m.push(dry.flush());
      const shortBy = target - m.integrated();
      if (Number.isFinite(shortBy)) gain *= 10 ** (Math.min(3, Math.max(0, shortBy)) / 20);
    }
    const limiter = new PeakLimiter(sampleRate, ceiling);
    const after = { lufs: new LoudnessMeter(sampleRate), tp: new TruePeakMeter() };
    const o = await deps.store.appender(out);
    let bytes = 0;
    const write = async (b: Uint8Array) => {
      if (!b.length) return;
      await o.write(b.slice());
      bytes += b.length;
    };
    try {
      const mp3 = req.format === 'mp3' ? await deps.mp3(sampleRate, MP3_KBPS) : undefined;
      await write(mp3 ? tag : wavHeader(samples, sampleRate, tag.length));
      const emit = async (pcm: Float32Array) => {
        after.lufs.push(pcm);
        after.tp.push(pcm);
        if (mp3) await write(mp3.encode(pcm));
        else {
          const s16 = floatToInt16(pcm);
          await write(new Uint8Array(s16.buffer, s16.byteOffset, s16.byteLength));
        }
      };
      for (let at = 0; at < samples; at += SCRATCH_CHUNK) {
        check();
        const { pcm, end } = await readChunk(at, gain);
        await emit(limiter.process(pcm));
        deps.onProgress?.({ phase: 'encode', done: end, total: samples });
      }
      await emit(limiter.flush());
      if (mp3) await write(mp3.finalize());
      else await write(wavId3Chunk(tag));
    } finally {
      await o.close();
    }
    return {
      path: out,
      filename: exportFilename(req.doc.title, req.format),
      bytes,
      duration: samples / sampleRate,
      chapters,
      lufs: after.lufs.integrated(),
      truePeakDb: after.tp.dbtp,
    };
  } catch (e) {
    await deps.store.remove(out);
    throw e;
  } finally {
    await deps.store.remove(scratch);
  }
}
