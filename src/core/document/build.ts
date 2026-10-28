/** Builds blocks with sentences and words from display text (pure; used by web and PDF sources). */
import { segmentSentences, segmentWords } from '../text/segment';
import type { AnchorRun, Block, BlockType, InlineMark, Sentence } from './model';

export interface BlockInput {
  id: string;
  type: BlockType;
  text: string;
  level?: number;
  anchors?: AnchorRun[];
  marks?: InlineMark[];
  skip?: Block['skip'];
}

export function buildSentences(blockId: string, text: string): Sentence[] {
  return segmentSentences(text).map((s, i) => ({
    id: `${blockId}.${i}`,
    blockId,
    start: s.start,
    end: s.end,
    words: segmentWords(text, s.start, s.end),
  }));
}

export function buildBlock(input: BlockInput): Block {
  const text = input.text.normalize('NFC');
  const block: Block = {
    id: input.id,
    type: input.type,
    text,
    anchors: input.anchors ?? [],
    // Headings, list items and code read as a single unit regardless of punctuation.
    sentences:
      input.type === 'code' || input.type === 'tableRow'
        ? wholeBlock(input.id, text)
        : buildSentences(input.id, text),
  };
  if (input.level !== undefined) block.level = input.level;
  if (input.marks?.length) block.marks = input.marks;
  if (input.skip) block.skip = input.skip;
  return block;
}

function wholeBlock(blockId: string, text: string): Sentence[] {
  const start = text.length - text.trimStart().length;
  const end = text.trimEnd().length;
  if (end <= start) return [];
  return [{ id: `${blockId}.0`, blockId, start, end, words: segmentWords(text, start, end) }];
}
