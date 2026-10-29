/** Converts a ReadingDocument into reader-view blocks and maps view positions to player sentences. */
import type { ReadingDocument } from '@/core/document/model';
import { Navigator } from '@/core/document/positions';
import type { MockBlock } from '../mock/mockDocument';

export interface DocView {
  blocks: MockBlock[];
  /** View sentence index → player sentence index (or -1 when skipped). */
  toPlayer: number[];
  /** Sentence id → view index. */
  viewIndexOf: Map<string, number>;
  nav: Navigator;
  /** Spoken characters from each player sentence to the end (time-left estimate). */
  charsFrom: number[];
}

export function docView(doc: ReadingDocument, announceSkippedCode = true): DocView {
  const nav = new Navigator(doc, { announceSkippedCode });
  const toPlayer: number[] = [];
  const viewIndexOf = new Map<string, number>();
  const blocks: MockBlock[] = doc.blocks.map((b) => ({
    id: b.id,
    type: b.type === 'heading' ? 'heading' : b.type === 'listItem' ? 'listItem' : 'paragraph',
    level: b.level,
    muted: !!b.skip && !(b.skip === 'code' && announceSkippedCode),
    sentences: b.sentences.map((s) => {
      viewIndexOf.set(s.id, toPlayer.length);
      toPlayer.push(nav.indexOf(s.id) ?? -1);
      return {
        id: s.id,
        text: b.text.slice(s.start, s.end),
        words: s.words.map((w) => ({ start: w.start - s.start, end: w.end - s.start })),
      };
    }),
  }));
  const charsFrom = new Array<number>(nav.length + 1).fill(0);
  for (let i = nav.length - 1; i >= 0; i--) {
    const s = nav.at(i)?.sentence;
    charsFrom[i] = (charsFrom[i + 1] ?? 0) + (s ? s.end - s.start : 0);
  }
  return { blocks, toPlayer, viewIndexOf, nav, charsFrom };
}

/** Seconds left from a sentence at a rate (~0.065 s per character at 1×). */
export function secondsLeft(v: DocView, sentence: number, rate: number): number {
  return ((v.charsFrom[Math.max(0, sentence)] ?? 0) * 0.065) / Math.max(0.5, rate);
}
