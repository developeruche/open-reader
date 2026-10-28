import { describe, expect, it } from 'vitest';
import { buildBlock } from '@/core/document/build';
import { mapRange } from '@/core/text/offsetMap';
import { buildSegments, FAST_START_CHARS, splitPoints } from '@/core/text/segments';

const para = (text: string, marks?: { start: number; end: number; kind: 'code' }[]) =>
  buildBlock({ id: 'p', type: 'paragraph', text, marks });

describe('buildSegments', () => {
  it('maps spoken words back to absolute block offsets', () => {
    const b = para('Intro sentence. A PSBT holds e.g. UTXO data.');
    const s = b.sentences[1]!;
    const [seg] = buildSegments({ block: b, sentence: s, lastInBlock: true });
    expect(seg!.spoken).toBe('A P S B T holds for example U T X O data.');
    const words = seg!.words.map((w) => [
      seg!.spoken.slice(w.spokenStart, w.spokenEnd),
      b.text.slice(w.displayStart, w.displayEnd),
    ]);
    expect(words).toContainEqual(['P', 'PSBT']);
    expect(words).toContainEqual(['example', 'e.g.']);
    expect(words).toContainEqual(['data', 'data']);
    const dataWord = seg!.words.find(
      (w) => seg!.spoken.slice(w.spokenStart, w.spokenEnd) === 'data',
    )!;
    expect(s.words[dataWord.sentenceWord]).toEqual({
      start: b.text.indexOf('data'),
      end: b.text.indexOf('data') + 4,
    });
    expect(seg!.pauseAfter).toBe(0.7);
    expect(seg!.id).toBe('p.1#0');
  });

  it('uses the pause between sentences when not last in block', () => {
    const b = para('One. Two.');
    expect(
      buildSegments({ block: b, sentence: b.sentences[0]!, lastInBlock: false })[0]!.pauseAfter,
    ).toBe(0.22);
  });

  it('splits long sentences at clause boundaries within the engine limit', () => {
    const long =
      'The creator proposes inputs, the updater adds scripts and derivation paths, each signer checks amounts and signs, and the finalizer extracts the transaction.';
    const b = para(long);
    const segs = buildSegments({
      block: b,
      sentence: b.sentences[0]!,
      lastInBlock: true,
      maxChars: 60,
    });
    expect(segs.length).toBeGreaterThan(1);
    for (const s of segs) expect(s.spoken.length).toBeLessThanOrEqual(60);
    expect(segs.map((s) => s.spoken).join(' ')).toBe(long);
    expect(segs.slice(0, -1).every((s) => s.pauseAfter === 0)).toBe(true);
    expect(segs.at(-1)!.pauseAfter).toBe(0.7);
    expect(segs.every((s, i) => s.part === i && s.parts === segs.length)).toBe(true);
    // Maps stay absolute after slicing.
    const last = segs.at(-1)!;
    const [ds] = mapRange(last.map, 0, 1);
    expect(b.text.slice(ds, ds + 3)).toBe(last.spoken.slice(0, 3));
  });

  it('fast start splits the first long sentence once at its first clause', () => {
    const long =
      'When the model runs on the GPU, the first audio arrives quickly, and the reader can start listening before the whole sentence has been synthesized by the engine.';
    expect(long.length).toBeGreaterThan(FAST_START_CHARS);
    const b = para(long);
    const segs = buildSegments({
      block: b,
      sentence: b.sentences[0]!,
      lastInBlock: true,
      fastStart: true,
      maxChars: 400,
    });
    expect(segs[0]!.spoken.length).toBeLessThanOrEqual(FAST_START_CHARS);
    expect(segs[0]!.spoken.endsWith(',')).toBe(true);
    expect(segs.length).toBe(2);
  });

  it('fast start leaves short sentences alone', () => {
    const b = para('Short sentence.');
    expect(
      buildSegments({ block: b, sentence: b.sentences[0]!, lastInBlock: true, fastStart: true }),
    ).toHaveLength(1);
  });

  it('announces a skipped code block in place of its text', () => {
    const b = {
      ...buildBlock({ id: 'c', type: 'code', text: 'npm install open-reader' }),
      skip: 'code' as const,
    };
    const [seg] = buildSegments({
      block: b,
      sentence: b.sentences[0]!,
      lastInBlock: true,
      sayInstead: 'Code block skipped.',
    });
    expect(seg!.spoken).toBe('Code block skipped.');
    expect(mapRange(seg!.map, 0, 4)).toEqual([0, b.text.length]);
  });

  it('passes inline code marks relative to the sentence', () => {
    const text = 'First. Then call getUserName() once.';
    const start = text.indexOf('getUserName');
    const b = para(text, [{ start, end: start + 13, kind: 'code' }]);
    expect(
      buildSegments({ block: b, sentence: b.sentences[1]!, lastInBlock: true })[0]!.spoken,
    ).toBe('Then call get user name once.');
  });

  it('returns nothing for text that normalizes to silence', () => {
    const b = para('[12]');
    expect(buildSegments({ block: b, sentence: b.sentences[0]!, lastInBlock: true })).toEqual([]);
  });
});

describe('splitPoints', () => {
  it('falls back to spaces, then hard cuts', () => {
    const words = 'alpha beta gamma delta epsilon zeta eta theta iota kappa';
    for (const c of splitPoints(words, 25)) expect(words[c]).toBe(' ');
    expect(splitPoints('x'.repeat(100), 30)).toEqual([30, 60, 90]);
    expect(splitPoints('short', 30)).toEqual([]);
  });
});
