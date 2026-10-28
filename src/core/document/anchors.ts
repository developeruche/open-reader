/** Lookups between block text offsets and source anchors. */
import type { Anchor, AnchorRun, Block } from './model';

/** The run containing `offset` (binary search; runs are sorted and non-overlapping). */
export function runAt(runs: readonly AnchorRun[], offset: number): AnchorRun | undefined {
  let lo = 0;
  let hi = runs.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const r = runs[mid];
    if (!r) break;
    if (offset < r.start) hi = mid - 1;
    else if (offset >= r.end) lo = mid + 1;
    else return r;
  }
  return undefined;
}

/** The source anchor for a text offset, shifted inside its run. */
export function anchorAt(block: Block, offset: number): Anchor | undefined {
  const r = runAt(block.anchors, offset);
  if (!r) return undefined;
  const delta = offset - r.start;
  return r.anchor.kind === 'dom'
    ? { ...r.anchor, offset: r.anchor.offset + delta }
    : { ...r.anchor, offset: r.anchor.offset + delta };
}

/** Every run piece covering text[start, end), clipped: one piece per source node/item. */
export function anchorPieces(
  block: Block,
  start: number,
  end: number,
): { start: number; end: number; anchor: Anchor }[] {
  const out: { start: number; end: number; anchor: Anchor }[] = [];
  for (const r of block.anchors) {
    if (r.end <= start || r.start >= end) continue;
    const s = Math.max(start, r.start);
    const e = Math.min(end, r.end);
    const shift = s - r.start;
    out.push({ start: s, end: e, anchor: { ...r.anchor, offset: r.anchor.offset + shift } });
  }
  return out;
}

/** Checks invariants: sorted, non-overlapping, inside the text. */
export function validateRuns(block: Block): string[] {
  const errors: string[] = [];
  let prev = 0;
  for (const r of block.anchors) {
    if (r.start < prev) errors.push(`run ${r.start}-${r.end} overlaps or is unsorted`);
    if (r.end <= r.start) errors.push(`run ${r.start}-${r.end} is empty`);
    if (r.end > block.text.length) errors.push(`run ${r.start}-${r.end} exceeds text`);
    prev = r.end;
  }
  return errors;
}
