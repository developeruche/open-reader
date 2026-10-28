import { describe, expect, it } from 'vitest';
import { anchorAt, anchorPieces, runAt, validateRuns } from '@/core/document/anchors';
import { buildBlock, buildSentences } from '@/core/document/build';
import type { ReadingDocument } from '@/core/document/model';
import { Navigator } from '@/core/document/positions';

function doc(): ReadingDocument {
  return {
    id: 'd1',
    kind: 'web',
    title: 'T',
    lang: 'en',
    blocks: [
      buildBlock({ id: 'h', type: 'heading', level: 1, text: 'The four roles' }),
      buildBlock({
        id: 'p1',
        type: 'paragraph',
        text: 'A PSBT is a container. Each wallet adds data. Nobody shares keys.',
      }),
      {
        ...buildBlock({ id: 'c', type: 'code', text: 'bitcoin-cli walletprocesspsbt' }),
        skip: 'code',
      },
      buildBlock({ id: 'l1', type: 'listItem', text: 'The creator proposes inputs.' }),
      buildBlock({ id: 'l2', type: 'listItem', text: 'The signer signs.' }),
    ],
  };
}

describe('buildBlock', () => {
  it('segments sentences and words with offsets into the text', () => {
    const b = buildBlock({ id: 'p', type: 'paragraph', text: 'Dr. Smith arrived. He sat down.' });
    expect(b.sentences.map((s) => b.text.slice(s.start, s.end))).toEqual([
      'Dr. Smith arrived.',
      'He sat down.',
    ]);
    expect(b.sentences[0]!.id).toBe('p.0');
    expect(b.sentences[1]!.words.map((w) => b.text.slice(w.start, w.end))).toEqual([
      'He',
      'sat',
      'down',
    ]);
  });

  it('normalizes to NFC and keeps level, marks and skip', () => {
    const b = buildBlock({
      id: 'h',
      type: 'heading',
      level: 2,
      text: 'Café',
      marks: [{ start: 0, end: 2, kind: 'code' }],
      skip: 'user',
    });
    expect(b.text).toBe('Café');
    expect(b.level).toBe(2);
    expect(b.marks).toHaveLength(1);
    expect(b.skip).toBe('user');
  });

  it('reads code and table rows as one unit', () => {
    const b = buildBlock({ id: 'c', type: 'code', text: '  a = 1. b = 2.  ' });
    expect(b.sentences).toHaveLength(1);
    expect(b.text.slice(b.sentences[0]!.start, b.sentences[0]!.end)).toBe('a = 1. b = 2.');
    expect(buildBlock({ id: 'e', type: 'tableRow', text: '   ' }).sentences).toEqual([]);
  });

  it('buildSentences ids are stable', () => {
    expect(buildSentences('x', 'One. Two.').map((s) => s.id)).toEqual(['x.0', 'x.1']);
  });
});

describe('anchors', () => {
  const block = {
    ...buildBlock({ id: 'p', type: 'paragraph', text: 'Hello brave world' }),
    anchors: [
      { start: 0, end: 6, anchor: { kind: 'dom' as const, nodeRef: 1, offset: 0 } },
      { start: 6, end: 12, anchor: { kind: 'dom' as const, nodeRef: 2, offset: 3 } },
      { start: 12, end: 17, anchor: { kind: 'pdf' as const, page: 2, item: 7, offset: 0 } },
    ],
  };

  it('finds the run at an offset', () => {
    expect(runAt(block.anchors, 0)?.anchor).toMatchObject({ nodeRef: 1 });
    expect(runAt(block.anchors, 6)?.anchor).toMatchObject({ nodeRef: 2 });
    expect(runAt(block.anchors, 16)?.anchor).toMatchObject({ item: 7 });
    expect(runAt(block.anchors, 17)).toBeUndefined();
    expect(runAt([], 0)).toBeUndefined();
  });

  it('shifts anchors inside a run', () => {
    expect(anchorAt(block, 8)).toEqual({ kind: 'dom', nodeRef: 2, offset: 5 });
    expect(anchorAt(block, 14)).toEqual({ kind: 'pdf', page: 2, item: 7, offset: 2 });
    expect(anchorAt(block, 99)).toBeUndefined();
  });

  it('splits a range into per-source pieces', () => {
    const pieces = anchorPieces(block, 4, 14);
    expect(pieces.map((p) => [p.start, p.end])).toEqual([
      [4, 6],
      [6, 12],
      [12, 14],
    ]);
    expect(pieces[0]!.anchor).toMatchObject({ nodeRef: 1, offset: 4 });
    expect(pieces[1]!.anchor).toMatchObject({ nodeRef: 2, offset: 3 });
  });

  it('validates run invariants', () => {
    expect(validateRuns(block)).toEqual([]);
    const bad = {
      ...block,
      anchors: [
        block.anchors[1]!,
        block.anchors[0]!,
        { start: 15, end: 15, anchor: block.anchors[0]!.anchor },
        { start: 16, end: 40, anchor: block.anchors[0]!.anchor },
      ],
    };
    expect(validateRuns(bad)).toHaveLength(3);
  });
});

describe('Navigator', () => {
  it('lists readable sentences and skips skipped blocks', () => {
    const nav = new Navigator(doc());
    expect(nav.length).toBe(6);
    expect(nav.sentences.map((s) => s.block.id)).toEqual(['h', 'p1', 'p1', 'p1', 'l1', 'l2']);
    expect(new Navigator(doc(), { announceSkippedCode: true }).length).toBe(7);
  });

  it('moves by sentence and clamps', () => {
    const nav = new Navigator(doc());
    expect(nav.next(0)).toBe(1);
    expect(nav.next(5)).toBeUndefined();
    expect(nav.prev(0)).toBeUndefined();
    expect(nav.prev(3)).toBe(2);
    expect(nav.clamp(-4)).toBe(0);
    expect(nav.clamp(99)).toBe(5);
    expect(nav.at(1)?.sentence.id).toBe('p1.0');
  });

  it('moves by block', () => {
    const nav = new Navigator(doc());
    expect(nav.nextBlock(1)).toBe(4);
    expect(nav.nextBlock(5)).toBeUndefined();
    expect(nav.prevBlock(3)).toBe(1);
    expect(nav.prevBlock(1)).toBe(0);
    expect(nav.prevBlock(0)).toBeUndefined();
    expect(nav.nextBlock(99)).toBeUndefined();
    expect(nav.prevBlock(99)).toBeUndefined();
  });

  it('maps block offsets to sentences and words (click-to-read)', () => {
    const nav = new Navigator(doc());
    const p1 = doc().blocks[1]!;
    const off = p1.text.indexOf('wallet');
    const i = nav.sentenceAtOffset('p1', off);
    expect(nav.at(i!)?.sentence.id).toBe('p1.1');
    expect(nav.wordAtOffset(i!, off)).toBe(1);
    expect(nav.sentenceAtOffset('p1', p1.text.indexOf(' Each'))).toBe(2);
    expect(nav.sentenceAtOffset('nope', 0)).toBeUndefined();
    expect(nav.wordAtOffset(99, 0)).toBe(0);
  });

  it('creates and resolves positions, falling back when a sentence vanished', () => {
    const nav = new Navigator(doc());
    const pos = nav.position(3, 2, 1000);
    expect(pos).toEqual({ docId: 'd1', sentenceId: 'p1.2', word: 2, updatedAt: 1000 });
    expect(nav.resolve(pos!)).toEqual({ index: 3, word: 2 });
    expect(nav.resolve({ docId: 'd1', sentenceId: 'p1.9', word: 4, updatedAt: 0 })).toEqual({
      index: 3,
      word: 0,
    });
    expect(nav.resolve({ docId: 'd1', sentenceId: 'zz.0', word: 4, updatedAt: 0 })).toEqual({
      index: 0,
      word: 0,
    });
    expect(nav.position(99, 0)).toBeUndefined();
    expect(nav.indexOf('l2.0')).toBe(5);
  });
});
