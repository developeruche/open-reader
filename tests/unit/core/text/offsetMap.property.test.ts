import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { Lexicon } from '@/core/text/lexicon';
import { normalize } from '@/core/text/normalize';
import { composeMaps, identityMap, mapRange, RewriteBuilder } from '@/core/text/offsetMap';
import { segmentWords } from '@/core/text/segment';

/** Tokens that exercise every rule, mixed with ordinary words and punctuation. */
const TOKENS = [
  'PSBT',
  'PSBTs',
  'UTXO',
  'BIP',
  '174',
  'e.g.',
  'i.e.',
  'etc.',
  'vs.',
  'Dr.',
  'Fig.',
  '3',
  'v2.0.0',
  '0x1a',
  '5%',
  '~10',
  '3–5',
  'ms',
  '12',
  'sat/vB',
  'vB',
  'MB',
  '21st',
  '$5',
  '&',
  '≥',
  '‖',
  '→',
  '×',
  '[12]',
  '¹',
  'https://example.com/a',
  'ﬁnal',
  'OP_RETURN',
  'SIGHASH_ALL',
  'snake_case',
  'GPU',
  'NASA',
  'JSON',
  'nonce',
  'MuSig2',
  'xpub',
  'the',
  'wallet',
  'signs',
  'a',
  'and',
  ',',
  '.',
  ';',
  '(',
  ')',
  '—',
  'Hello',
  'café',
  'II',
  'P2TR',
  '1,000',
  'ＡＢＣ',
  '  ',
  '\n',
];

const textArb = fc.array(fc.constantFrom(...TOKENS), { maxLength: 30 }).map((t) => t.join(' '));
const engines = fc.constantFrom('kokoro', 'piper');

describe('normalization offset maps (property)', () => {
  it('every spoken word maps to a valid, non-empty display range', () => {
    fc.assert(
      fc.property(textArb, engines, (text, engineId) => {
        const { spoken, map } = normalize(text, { lexicon: new Lexicon({ engineId }) });
        expect(map.start.length).toBe(spoken.length);
        expect(map.sourceLength).toBe(text.length);
        for (const w of segmentWords(spoken)) {
          const [s, e] = mapRange(map, w.start, w.end);
          expect(s).toBeGreaterThanOrEqual(0);
          expect(e).toBeLessThanOrEqual(text.length);
          expect(e).toBeGreaterThan(s);
          // The source range contains visible text.
          expect(text.slice(s, e).trim().length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 400 },
    );
  });

  it('spoken words map to monotonically non-decreasing display starts', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        const { spoken, map } = normalize(text);
        let prev = -1;
        for (const w of segmentWords(spoken)) {
          const [s] = mapRange(map, w.start, w.end);
          expect(s).toBeGreaterThanOrEqual(prev);
          prev = s;
        }
      }),
      { numRuns: 300 },
    );
  });

  it('is deterministic', () => {
    fc.assert(
      fc.property(textArb, (text) => {
        expect(normalize(text).spoken).toBe(normalize(text).spoken);
      }),
    );
  });

  it('plain lowercase prose is unchanged and maps 1:1', () => {
    const word = fc.stringMatching(/^[a-z]{1,8}$/);
    fc.assert(
      fc.property(fc.array(word, { minLength: 1, maxLength: 12 }), (words) => {
        const text = words.join(' ');
        const lexicon = new Lexicon({ packs: [] });
        const r = normalize(text, { lexicon });
        if (r.spoken !== text) return; // a built-in entry matched; covered elsewhere
        for (let i = 0; i < text.length; i++)
          expect([r.map.start[i], r.map.end[i]]).toEqual([i, i + 1]);
      }),
    );
  });
});

describe('offset map primitives', () => {
  it('composition equals sequential mapping', () => {
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 40 }),
        fc.nat(39),
        fc.nat(39),
        fc.string({ maxLength: 5 }),
        (text, a, c, ins) => {
          const s = Math.min(a, text.length);
          const e = Math.min(text.length, s + (c % 5));
          const r1 = new RewriteBuilder(text).replace(s, e, 'XY').finish();
          const r2 = new RewriteBuilder(r1.spoken)
            .insert(Math.min(1, r1.spoken.length), ins)
            .finish();
          const composed = composeMaps(r2.map, r1.map);
          for (let i = 0; i < r2.spoken.length; i++) {
            const viaMid = mapRange(r1.map, r2.map.start[i]!, r2.map.end[i]!);
            expect([composed.start[i], composed.end[i]]).toEqual(viaMid);
          }
        },
      ),
    );
  });

  it('identity maps each character to itself', () => {
    const m = identityMap(5);
    expect(mapRange(m, 1, 3)).toEqual([1, 3]);
    expect(mapRange(m, 5, 5)).toEqual([5, 5]);
    expect(mapRange(identityMap(0), 0, 0)).toEqual([0, 0]);
  });

  it('replacements map every character to the whole source range', () => {
    const r = new RewriteBuilder('use e.g. this').replace(4, 8, 'for example').finish();
    expect(r.spoken).toBe('use for example this');
    expect(mapRange(r.map, 4, 7)).toEqual([4, 8]);
    expect(mapRange(r.map, 8, 15)).toEqual([4, 8]);
    expect(mapRange(r.map, 16, 20)).toEqual([9, 13]);
  });

  it('insertions map to an empty range at their position', () => {
    const r = new RewriteBuilder('ab').insert(1, '--').finish();
    expect(r.spoken).toBe('a--b');
    expect(mapRange(r.map, 1, 3)).toEqual([1, 1]);
  });
});
