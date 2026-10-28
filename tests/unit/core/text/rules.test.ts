import { describe, expect, it } from 'vitest';
import { buildBlock } from '@/core/document/build';
import type { Block } from '@/core/document/model';
import { BITCOIN_PACK, Lexicon } from '@/core/text/lexicon';
import { cardinal, ordinal } from '@/core/text/numbers';
import { NATURAL_PAUSES, pauseAfter } from '@/core/text/pacing';
import {
  applySkipRules,
  DEFAULT_SKIP_RULES,
  inlineSkips,
  skipAnnouncement,
  skipReason,
  SkipRulesSchema,
} from '@/core/text/skip';

const block = (type: Block['type'], skip?: Block['skip']): Block => ({
  ...buildBlock({ id: 'b', type, text: 'Some text.' }),
  ...(skip ? { skip } : {}),
});

describe('skip rules', () => {
  it('has the §5.2.2 defaults', () => {
    expect(DEFAULT_SKIP_RULES).toMatchObject({
      codeBlocks: 'skip',
      tables: 'skip',
      imageAlt: 'skip',
      captions: 'read',
      citations: 'skip',
      urls: 'skip',
      references: 'skip',
      headersFooters: 'skip',
    });
    expect(inlineSkips(DEFAULT_SKIP_RULES)).toEqual({
      citations: true,
      footnoteMarkers: true,
      urls: 'skip',
    });
  });

  it.each([
    ['code', undefined, 'code'],
    ['tableRow', undefined, 'table'],
    ['reference', undefined, 'reference'],
    ['caption', undefined, undefined],
    ['paragraph', undefined, undefined],
    ['heading', undefined, undefined],
    ['paragraph', 'headerFooter', 'headerFooter'],
    ['paragraph', 'pageNumber', 'pageNumber'],
    ['paragraph', 'imageAlt', 'imageAlt'],
    ['paragraph', 'user', 'user'],
    ['footnote', 'footnote', 'footnote'],
  ] as const)('%s (preset %s) → %s', (type, preset, reason) => {
    expect(skipReason(block(type, preset), DEFAULT_SKIP_RULES)).toBe(reason);
  });

  it('honours overrides', () => {
    const rules = SkipRulesSchema.parse({
      codeBlocks: 'read',
      tables: 'read',
      captions: 'skip',
      headersFooters: 'read',
      imageAlt: 'read',
      references: 'read',
    });
    expect(skipReason(block('code'), rules)).toBeUndefined();
    expect(skipReason(block('tableRow'), rules)).toBeUndefined();
    expect(skipReason(block('caption'), rules)).toBe('imageAlt');
    expect(skipReason(block('paragraph', 'headerFooter'), rules)).toBeUndefined();
    expect(skipReason(block('paragraph', 'imageAlt'), rules)).toBeUndefined();
    expect(skipReason(block('reference'), rules)).toBeUndefined();
  });

  it('applies to a list of blocks and announces skipped code once', () => {
    const [code, para] = applySkipRules(
      [block('code'), block('paragraph', 'headerFooter')],
      SkipRulesSchema.parse({ headersFooters: 'read' }),
    );
    expect(code?.skip).toBe('code');
    expect(para?.skip).toBeUndefined();
    expect(skipAnnouncement(code!, DEFAULT_SKIP_RULES)).toBe('Code block skipped.');
    expect(
      skipAnnouncement(code!, { ...DEFAULT_SKIP_RULES, announceSkippedCode: false }),
    ).toBeUndefined();
  });

  it('rejects invalid settings', () => {
    expect(() => SkipRulesSchema.parse({ tables: 'maybe' })).toThrow();
  });
});

describe('pacing', () => {
  it.each([
    [{ blockType: 'paragraph', lastInBlock: false }, NATURAL_PAUSES.betweenSentences],
    [
      { blockType: 'listItem', lastInBlock: true, nextBlockType: 'listItem' },
      NATURAL_PAUSES.afterListItem,
    ],
    [
      { blockType: 'paragraph', lastInBlock: true, nextBlockType: 'paragraph' },
      NATURAL_PAUSES.afterParagraph,
    ],
    [
      { blockType: 'paragraph', lastInBlock: true, nextBlockType: 'heading' },
      NATURAL_PAUSES.beforeHeading,
    ],
    [
      { blockType: 'heading', lastInBlock: true, nextBlockType: 'paragraph' },
      NATURAL_PAUSES.afterHeading,
    ],
    [{ blockType: 'paragraph', lastInBlock: true }, NATURAL_PAUSES.afterParagraph],
  ] as const)('%j → %s s', (ctx, s) => expect(pauseAfter(ctx)).toBe(s));

  it('scales by preset', () => {
    const ctx = { blockType: 'paragraph', lastInBlock: true } as const;
    expect(pauseAfter(ctx, 'brisk')).toBeCloseTo(0.42);
    expect(pauseAfter(ctx, 'relaxed')).toBeCloseTo(0.98);
  });
});

describe('number words', () => {
  it.each([
    [0, 'zero'],
    [7, 'seven'],
    [15, 'fifteen'],
    [40, 'forty'],
    [99, 'ninety-nine'],
    [100, 'one hundred'],
    [342, 'three hundred forty-two'],
    [1000, 'one thousand'],
    [21_005, 'twenty-one thousand five'],
    [1_000_000, 'one million'],
    [2_500_301, 'two million five hundred thousand three hundred one'],
  ])('cardinal %i', (n, w) => expect(cardinal(n)).toBe(w));

  it('leaves out-of-range and non-integers as digits', () => {
    expect(cardinal(1.5)).toBe('1.5');
    expect(cardinal(-1)).toBe('-1');
    expect(cardinal(1e9)).toBe('1000000000');
  });

  it.each([
    [1, 'first'],
    [12, 'twelfth'],
    [30, 'thirtieth'],
    [1001, 'one thousand first'],
    [2024, 'two thousand twenty-fourth'],
  ])('ordinal %i', (n, w) => expect(ordinal(n)).toBe(w));
});

describe('lexicon', () => {
  it('reports known words, including plurals', () => {
    const lx = new Lexicon();
    expect(lx.has('PSBT')).toBe(true);
    expect(lx.has('PSBTs')).toBe(true);
    expect(lx.has('JSON')).toBe(true);
    expect(lx.has('yaml')).toBe(true);
    expect(lx.has('banana')).toBe(false);
  });

  it('respects case sensitivity and whole words', () => {
    const lx = new Lexicon({ packs: [BITCOIN_PACK] });
    expect(lx.apply('bip and BIP').spoken).toBe('bip and bip');
    expect(lx.apply('a PSBTx').spoken).toBe('a PSBTx');
    expect(lx.apply('the bip-32 path').spoken).toBe('the bip-32 path');
  });

  it('supports regex user entries with groups', () => {
    const lx = new Lexicon({ user: [{ match: /\bRFC ?(\d+)\b/, say: 'R F C $1' }], packs: [] });
    expect(lx.apply('see RFC 8259').spoken).toBe('see r f c 8259');
  });

  it('can exclude packs', () => {
    expect(new Lexicon({ packs: [] }).apply('a PSBT').spoken).toBe('a PSBT');
  });
});
