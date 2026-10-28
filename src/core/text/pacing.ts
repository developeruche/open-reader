/** Structural pauses (PLAN.md §5.2.5): the "Natural" values that made the PSBT audiobook sound right. */
import type { BlockType } from '../document/model';

export type PacingPreset = 'brisk' | 'natural' | 'relaxed';

export const PACING_SCALE: Record<PacingPreset, number> = { brisk: 0.6, natural: 1, relaxed: 1.4 };

export const NATURAL_PAUSES = {
  betweenSentences: 0.22,
  afterListItem: 0.45,
  afterParagraph: 0.7,
  beforeHeading: 1.3,
  afterHeading: 0.8,
} as const;

export interface PauseContext {
  blockType: BlockType;
  /** Last sentence of its block. */
  lastInBlock: boolean;
  /** Type of the next spoken block, if any. */
  nextBlockType?: BlockType;
}

/** Seconds of silence after a sentence, before scaling by preset. */
export function pauseAfter(ctx: PauseContext, preset: PacingPreset = 'natural'): number {
  const p = NATURAL_PAUSES;
  let s: number;
  if (!ctx.lastInBlock) s = p.betweenSentences;
  else if (ctx.blockType === 'heading') s = p.afterHeading;
  else if (ctx.nextBlockType === 'heading') s = p.beforeHeading;
  else if (ctx.blockType === 'listItem') s = p.afterListItem;
  else s = p.afterParagraph;
  return +(s * PACING_SCALE[preset]).toFixed(3);
}
