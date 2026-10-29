import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { parseBuffer } from 'music-metadata';
import { describe, expect, it } from 'vitest';
import { createEncoder } from 'wasm-media-encoders';
import { TruePeakMeter } from '@/core/audio/loudness';
import { decodeWav } from '@/core/audio/wav';
import { buildBlock } from '@/core/document/build';
import type { ReadingDocument } from '@/core/document/model';
import { Navigator } from '@/core/document/positions';
import { MemoryCache } from '@/core/player/cache';
import { renderSegment, sentenceSegments } from '@/core/player/render';
import { Lexicon } from '@/core/text/lexicon';
import { applySkipRules, DEFAULT_SKIP_RULES } from '@/core/text/skip';
import { TestEngine } from '@/engines/test/engine';
import {
  exportFilename,
  limitChapters,
  runExport,
  type ExportStore,
  MP3_DELAY_SAMPLES,
  type Mp3Encoder,
} from '@/runtime/export';

const blocks = [
  buildBlock({ id: 'p0', type: 'paragraph', text: 'A short introduction comes first.' }),
  buildBlock({ id: 'h1', type: 'heading', level: 1, text: 'The four roles' }),
  buildBlock({
    id: 'p1',
    type: 'paragraph',
    text: 'A PSBT is a container. Each wallet adds data.',
  }),
  buildBlock({ id: 'c', type: 'code', text: 'bitcoin-cli walletprocesspsbt' }),
  buildBlock({ id: 'h2', type: 'heading', level: 2, text: 'Signing' }),
  buildBlock({ id: 'p2', type: 'paragraph', text: 'The signer signs. That is all.' }),
];
const doc: ReadingDocument = {
  id: 'd',
  kind: 'web',
  title: 'PSBTs: a guide',
  lang: 'en',
  blocks: applySkipRules(blocks, DEFAULT_SKIP_RULES),
};

class MemoryExportStore implements ExportStore {
  readonly files = new Map<string, Uint8Array>();
  async appender(p: string) {
    return {
      write: async (chunk: Uint8Array) => {
        const old = this.files.get(p) ?? new Uint8Array(0);
        const next = new Uint8Array(old.length + chunk.length);
        next.set(old);
        next.set(chunk, old.length);
        this.files.set(p, next);
      },
      close: async () => undefined,
    };
  }
  async slice(p: string, start: number, end: number) {
    return (this.files.get(p) ?? new Uint8Array(0)).slice(start, end).buffer;
  }
  async remove(p: string) {
    this.files.delete(p);
  }
}

const wasm = readFileSync('node_modules/wasm-media-encoders/wasm/mp3.wasm');
async function mp3(sampleRate: number, kbps: number): Promise<Mp3Encoder> {
  const e = await createEncoder('audio/mpeg', wasm);
  e.configure({ sampleRate, channels: 1, bitrate: kbps as 64 });
  return { encode: (pcm) => e.encode([pcm]), finalize: () => e.finalize() };
}

const lexicon = new Lexicon({ engineId: 'test' });
const settings = {
  voice: 'test',
  pacing: 'natural' as const,
  skipRules: DEFAULT_SKIP_RULES,
  lexicon,
};

/** The playback plan: the player's segments and their rendered durations. */
async function plannedSeconds(): Promise<number> {
  const engine = new TestEngine();
  const nav = new Navigator(doc, { announceSkippedCode: true });
  let total = 0;
  for (let s = 0; s < nav.length; s++)
    for (const seg of sentenceSegments(nav, s, { ...settings, maxChars: engine.caps.maxChars }))
      total += (
        await renderSegment(
          { engine, model: { modelId: 't', version: '1' }, lang: 'en', now: Date.now },
          seg,
          'test',
          1,
        )
      ).audio.duration;
  return total;
}

describe('audiobook export', () => {
  it('writes an MP3 with a chapter per heading, at −17 LUFS, as long as the playback plan', async () => {
    const store = new MemoryExportStore();
    const progress: string[] = [];
    const r = await runExport(
      { jobId: 'j1', doc, format: 'mp3', ...settings, artist: 'Open Reader · test voice' },
      {
        render: {
          engine: new TestEngine(),
          model: { modelId: 't', version: '1' },
          cache: new MemoryCache(),
          lang: 'en',
          now: Date.now,
        },
        store,
        mp3,
        onProgress: (p) => progress.push(p.phase),
      },
    );
    expect(r.filename).toBe('PSBTs a guide.mp3');
    expect(r.duration).toBeCloseTo(await plannedSeconds(), 6);
    // Before encoding: −17 LUFS plus the 0.5 LU that 64 kbps MP3 loses.
    expect(r.lufs).toBeGreaterThan(-16.8);
    expect(r.lufs).toBeLessThan(-16.2);
    expect(r.truePeakDb).toBeLessThanOrEqual(-1.5);
    expect(progress).toContain('render');
    expect(progress.at(-1)).toBe('encode');
    // Only the output remains; the scratch PCM is gone.
    expect([...store.files.keys()]).toEqual(['exports/j1.mp3']);
    const bytes = store.files.get('exports/j1.mp3') ?? new Uint8Array();
    expect(bytes.length).toBe(r.bytes);

    const m = await parseBuffer(bytes, { mimeType: 'audio/mpeg' }, { duration: true });
    expect(m.common.title).toBe('PSBTs: a guide');
    expect(m.common.artist).toBe('Open Reader · test voice');
    // Decoded length = plan + LAME's delay, rounded up to whole MPEG frames (576 samples here).
    const sr = 8000;
    expect(m.format.duration ?? 0).toBeGreaterThanOrEqual(r.duration);
    expect(m.format.duration ?? 0).toBeLessThanOrEqual(
      r.duration + (MP3_DELAY_SAMPLES + 2 * 576) / sr,
    );
    const chaps = (m.native['ID3v2.3'] ?? []).filter((t) => t.id === 'CHAP');
    expect(chaps.length).toBe(3);
    expect(r.chapters.map((c) => c.title)).toEqual(['PSBTs: a guide', 'The four roles', 'Signing']);
    expect(r.chapters[0]?.startMs).toBe(0);
    const delayMs = (MP3_DELAY_SAMPLES / sr) * 1000;
    expect(r.chapters.at(-1)?.endMs).toBe(Math.round(r.duration * 1000 + delayMs));
    expect(r.chapters[1]?.startMs).toBeGreaterThan(delayMs);
    for (let i = 1; i < r.chapters.length; i++)
      expect(r.chapters[i]?.startMs).toBe(r.chapters[i - 1]?.endMs);

    // ffprobe (FFmpeg) reads the same chapters when it is installed.
    let ffprobe = true;
    try {
      execFileSync('ffprobe', ['-version'], { stdio: 'ignore' });
    } catch {
      ffprobe = false;
    }
    if (ffprobe) {
      const dir = mkdtempSync(path.join(tmpdir(), 'or-export-'));
      try {
        const file = path.join(dir, 'a.mp3');
        writeFileSync(file, bytes);
        const info = JSON.parse(
          execFileSync('ffprobe', ['-v', 'error', '-show_chapters', '-of', 'json', file], {
            encoding: 'utf8',
          }),
        ) as { chapters: { start_time: string; end_time: string; tags: { title: string } }[] };
        expect(info.chapters.map((c) => c.tags.title)).toEqual(r.chapters.map((c) => c.title));
        expect(Number(info.chapters[1]?.start_time)).toBeCloseTo(
          (r.chapters[1]?.startMs ?? 0) / 1000,
          2,
        );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  }, 30_000);

  it('writes a WAV whose samples and tag chunk round-trip', async () => {
    const store = new MemoryExportStore();
    const r = await runExport(
      { jobId: 'j2', doc, format: 'wav', ...settings },
      {
        render: {
          engine: new TestEngine(),
          model: { modelId: 't', version: '1' },
          lang: 'en',
          now: Date.now,
        },
        store,
        mp3,
      },
    );
    const bytes = store.files.get('exports/j2.wav') ?? new Uint8Array();
    const wav = decodeWav(bytes);
    expect(wav.pcm.length / wav.sampleRate).toBeCloseTo(r.duration, 6);
    expect(r.lufs).toBeGreaterThan(-17.3);
    expect(r.lufs).toBeLessThan(-16.7);
    const tp = new TruePeakMeter();
    tp.push(Float32Array.from(wav.pcm, (x) => x / 32768));
    expect(tp.dbtp).toBeLessThanOrEqual(-1.4);
    const m = await parseBuffer(bytes, { mimeType: 'audio/wav' }, { duration: true });
    expect(m.common.title).toBe('PSBTs: a guide');
  });

  it('cancels cleanly and refuses a document with nothing to read', async () => {
    const store = new MemoryExportStore();
    const ac = new AbortController();
    const run = runExport(
      { jobId: 'j3', doc, format: 'mp3', ...settings },
      {
        render: {
          engine: new TestEngine(),
          model: { modelId: 't', version: '1' },
          lang: 'en',
          now: Date.now,
        },
        store,
        mp3,
        onProgress: (p) => p.done === 2 && ac.abort(),
      },
      ac.signal,
    );
    await expect(run).rejects.toMatchObject({ name: 'AbortError' });
    expect(store.files.size).toBe(0);
    const empty = { ...doc, blocks: doc.blocks.filter((b) => b.skip) };
    await expect(
      runExport(
        {
          jobId: 'j4',
          doc: empty,
          format: 'wav',
          ...settings,
          skipRules: { ...DEFAULT_SKIP_RULES, announceSkippedCode: false },
        },
        {
          render: {
            engine: new TestEngine(),
            model: { modelId: 't', version: '1' },
            lang: 'en',
            now: Date.now,
          },
          store,
          mp3,
        },
      ),
    ).rejects.toThrow(/Nothing to export/);
  });

  it('names files safely and keeps at most 255 chapters by dropping deep levels', () => {
    expect(exportFilename('a/b:c*?"<>| d', 'wav')).toBe('a b c d.wav');
    expect(exportFilename('   ', 'mp3')).toBe('Open Reader audiobook.mp3');
    const heads = Array.from({ length: 400 }, (_, i) => ({
      title: `h${i}`,
      level: i % 4 === 0 ? 1 : 3,
      startMs: i,
      endMs: 0,
    }));
    const kept = limitChapters(heads);
    expect(kept.length).toBe(100);
    expect(kept.every((h) => h.level === 1)).toBe(true);
  });
});
