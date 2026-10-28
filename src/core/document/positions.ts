/** Navigation over a document's readable sentences (skipped blocks excluded). */
import type { Block, ReadingDocument, ReadingPosition, Sentence } from './model';

export interface SentenceRef {
  /** Index into the flat list of readable sentences. */
  index: number;
  block: Block;
  blockIndex: number;
  sentence: Sentence;
}

export interface NavigatorOptions {
  /** Keep skipped code blocks so the voice can say "Code block skipped." once. */
  announceSkippedCode?: boolean;
}

/** Flat list of sentences the voice will read, in order. */
export function readableSentences(
  doc: ReadingDocument,
  opts: NavigatorOptions = {},
): SentenceRef[] {
  const out: SentenceRef[] = [];
  doc.blocks.forEach((block, blockIndex) => {
    if (block.skip && !(block.skip === 'code' && opts.announceSkippedCode)) return;
    for (const sentence of block.sentences)
      out.push({ index: out.length, block, blockIndex, sentence });
  });
  return out;
}

export class Navigator {
  readonly sentences: SentenceRef[];
  private readonly byId = new Map<string, number>();

  constructor(
    readonly doc: ReadingDocument,
    opts: NavigatorOptions = {},
  ) {
    this.sentences = readableSentences(doc, opts);
    this.sentences.forEach((s) => this.byId.set(s.sentence.id, s.index));
  }

  get length(): number {
    return this.sentences.length;
  }

  indexOf(sentenceId: string): number | undefined {
    return this.byId.get(sentenceId);
  }

  at(index: number): SentenceRef | undefined {
    return this.sentences[index];
  }

  clamp(index: number): number {
    return Math.max(0, Math.min(this.length - 1, index));
  }

  next(index: number): number | undefined {
    return index + 1 < this.length ? index + 1 : undefined;
  }

  prev(index: number): number | undefined {
    return index > 0 ? index - 1 : undefined;
  }

  /** First sentence of the next readable block. */
  nextBlock(index: number): number | undefined {
    const cur = this.sentences[index];
    if (!cur) return undefined;
    for (let i = index + 1; i < this.length; i++)
      if (this.sentences[i]?.blockIndex !== cur.blockIndex) return i;
    return undefined;
  }

  /** First sentence of the current block, or of the previous block if already at its start. */
  prevBlock(index: number): number | undefined {
    const cur = this.sentences[index];
    if (!cur) return undefined;
    const startOf = (i: number) => {
      const b = this.sentences[i]?.blockIndex;
      while (i > 0 && this.sentences[i - 1]?.blockIndex === b) i--;
      return i;
    };
    const start = startOf(index);
    if (start < index) return start;
    return start > 0 ? startOf(start - 1) : undefined;
  }

  /** The readable sentence containing (or following) a block offset; for click-to-read. */
  sentenceAtOffset(blockId: string, offset: number): number | undefined {
    let after: number | undefined;
    for (const s of this.sentences) {
      if (s.block.id !== blockId) continue;
      if (offset >= s.sentence.start && offset < s.sentence.end) return s.index;
      if (after === undefined && s.sentence.start >= offset) after = s.index;
    }
    return after;
  }

  /** Word index within a sentence containing a block offset (0 if between words). */
  wordAtOffset(index: number, offset: number): number {
    const s = this.sentences[index]?.sentence;
    if (!s) return 0;
    const i = s.words.findIndex((w) => offset < w.end);
    return Math.max(0, i);
  }

  position(index: number, word: number, now = Date.now()): ReadingPosition | undefined {
    const s = this.sentences[index];
    return s ? { docId: this.doc.id, sentenceId: s.sentence.id, word, updatedAt: now } : undefined;
  }

  /** Resolves a saved position; falls back to the nearest earlier sentence if it vanished. */
  resolve(pos: ReadingPosition): { index: number; word: number } {
    const i = this.indexOf(pos.sentenceId);
    if (i !== undefined) return { index: i, word: pos.word };
    const [blockId, n] = pos.sentenceId.split(/\.(?=\d+$)/);
    const candidates = this.sentences.filter(
      (s) => s.block.id === blockId && Number(s.sentence.id.split('.').pop()) <= Number(n),
    );
    const last = candidates.at(-1);
    return { index: last?.index ?? 0, word: 0 };
  }
}
