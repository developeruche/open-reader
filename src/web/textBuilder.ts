/**
 * Builds a block's display text from text nodes, collapsing whitespace like a browser does, while
 * keeping exact AnchorRuns back to each node (so highlights land on the real characters).
 */
import type { AnchorRun, InlineMark } from '@/core/document/model';

export class BlockTextBuilder {
  text = '';
  readonly anchors: AnchorRun[] = [];
  readonly marks: InlineMark[] = [];
  private pendingSpace = false;

  /** Appends a node's text; `ref` undefined means the text has no live node (unmapped). */
  append(
    content: string,
    ref: number | undefined,
    opts: { code?: boolean; preserve?: boolean; nodeStart?: number } = {},
  ): void {
    const markStart = this.text.length + (this.pendingSpace && this.text ? 1 : 0);
    const base = opts.nodeStart ?? 0;
    for (let i = 0; i < content.length; i++) {
      const ch = content[i] ?? '';
      if (!opts.preserve && /\s/.test(ch)) {
        this.pendingSpace = true;
        continue;
      }
      // Collapsed whitespace may span nodes; the single space it becomes has no source anchor.
      if (this.pendingSpace && this.text) this.push(' ', undefined, 0);
      this.pendingSpace = false;
      this.push(ch, ref, base + i);
    }
    if (opts.code && this.text.length > markStart)
      this.marks.push({ start: markStart, end: this.text.length, kind: 'code' });
  }

  /** Inserts a separator with no source (e.g. between table cells). */
  separator(s: string): void {
    if (!this.text) return;
    this.pendingSpace = false;
    this.text += s;
  }

  private push(ch: string, ref: number | undefined, nodeOffset: number): void {
    const at = this.text.length;
    this.text += ch;
    if (ref === undefined) return;
    const last = this.anchors.at(-1);
    if (
      last &&
      last.anchor.kind === 'dom' &&
      last.anchor.nodeRef === ref &&
      last.end === at &&
      last.anchor.offset + (last.end - last.start) === nodeOffset
    ) {
      last.end = at + 1;
    } else {
      this.anchors.push({
        start: at,
        end: at + 1,
        anchor: { kind: 'dom', nodeRef: ref, offset: nodeOffset },
      });
    }
  }
}
