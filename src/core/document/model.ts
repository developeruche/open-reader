/** The reading document model (PLAN.md §5.1). Every source becomes this shape. */

export type DocKind = 'web' | 'pdf';

export interface ReadingDocument {
  /** sha256 of the canonical URL or of the PDF bytes. */
  id: string;
  kind: DocKind;
  title: string;
  /** BCP-47; 'en' for v1. */
  lang: string;
  blocks: Block[];
}

export type BlockType =
  | 'heading'
  | 'paragraph'
  | 'listItem'
  | 'quote'
  | 'caption'
  | 'code'
  | 'tableRow'
  | 'footnote'
  | 'reference';

export type SkipReason =
  'code' | 'table' | 'imageAlt' | 'reference' | 'headerFooter' | 'pageNumber' | 'footnote' | 'user';

/** Inline spans inside a block's text (extension to §5.1 so inline code can be read differently). */
export interface InlineMark {
  start: number;
  end: number;
  kind: 'code' | 'link';
}

export interface Block {
  id: string;
  type: BlockType;
  /** Heading level or list depth. */
  level?: number;
  /** Display text (NFC), as the user sees it. */
  text: string;
  anchors: AnchorRun[];
  sentences: Sentence[];
  /** Set by reading rules; skipped blocks stay visible in the UI. */
  skip?: SkipReason;
  marks?: InlineMark[];
}

export interface Sentence {
  id: string;
  blockId: string;
  start: number;
  end: number;
  words: Word[];
}

/** Offsets into block.text. */
export interface Word {
  start: number;
  end: number;
}

export type Anchor =
  | { kind: 'dom'; nodeRef: number; offset: number }
  | { kind: 'pdf'; page: number; item: number; offset: number };

/** A contiguous mapping: block.text[start, end) comes from the source starting at `anchor`. */
export interface AnchorRun {
  start: number;
  end: number;
  anchor: Anchor;
}

export interface ReadingPosition {
  docId: string;
  sentenceId: string;
  word: number;
  updatedAt: number;
}
