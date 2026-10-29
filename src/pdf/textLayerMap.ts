/**
 * PDF anchors ↔ text layer DOM (PLAN.md §8.4, ADR 0007). PDF.js appends a span only for items with
 * str !== '', so span index = number of non-empty items before the item.
 */
import { anchorPieces } from '@/core/document/anchors';
import type { Block, ReadingDocument } from '@/core/document/model';
import type { PdfPageText } from './layout';

export class TextLayerMap {
  private readonly spans = new Map<number, HTMLElement[]>();
  /** item index → span index per page. */
  private readonly spanIndex = new Map<number, Int32Array>();

  constructor(
    private readonly pages: PdfPageText[],
    private readonly pageDiv: (page: number) => HTMLElement | undefined,
  ) {
    for (const p of pages) {
      const map = new Int32Array(p.items.length).fill(-1);
      let n = 0;
      p.items.forEach((it, i) => {
        if (it.str !== '') map[i] = n++;
      });
      this.spanIndex.set(p.page, map);
    }
  }

  /** Forget cached spans for a page (after its text layer re-renders, e.g. on zoom). */
  invalidate(page: number): void {
    this.spans.delete(page);
  }

  private pageSpans(page: number): HTMLElement[] | undefined {
    const cached = this.spans.get(page);
    if (cached?.[0]?.isConnected) return cached;
    const layer = this.pageDiv(page)?.querySelector('.textLayer');
    if (!layer) return undefined;
    const spans = [...layer.querySelectorAll<HTMLElement>('span:not(.markedContent)')].filter(
      (s) => !s.closest('.highlight') || s.parentElement?.closest('.textLayer') === layer,
    );
    if (!spans.length) return undefined;
    this.spans.set(page, spans);
    return spans;
  }

  textNode(page: number, item: number): Text | undefined {
    const idx = this.spanIndex.get(page)?.[item] ?? -1;
    const span = idx >= 0 ? this.pageSpans(page)?.[idx] : undefined;
    const t = span?.firstChild;
    return t && t.nodeType === Node.TEXT_NODE ? (t as Text) : undefined;
  }

  /** Ranges (one per page) covering block.text[start, end); pages not rendered yet are omitted. */
  ranges(block: Block, start: number, end: number): { ranges: Range[]; pages: number[] } {
    const byPage = new Map<
      number,
      {
        first: { item: number; offset: number };
        last: { item: number; offset: number; len: number };
      }
    >();
    for (const p of anchorPieces(block, start, end)) {
      if (p.anchor.kind !== 'pdf') continue;
      const len = p.end - p.start;
      const e = byPage.get(p.anchor.page);
      if (!e)
        byPage.set(p.anchor.page, {
          first: { item: p.anchor.item, offset: p.anchor.offset },
          last: { item: p.anchor.item, offset: p.anchor.offset, len },
        });
      else e.last = { item: p.anchor.item, offset: p.anchor.offset, len };
    }
    const ranges: Range[] = [];
    const pages = [...byPage.keys()];
    for (const [page, { first, last }] of byPage) {
      const a = this.textNode(page, first.item);
      const b = this.textNode(page, last.item);
      if (!a || !b) continue;
      const r = a.ownerDocument.createRange();
      try {
        r.setStart(a, Math.min(first.offset, a.length));
        r.setEnd(b, Math.min(last.offset + last.len, b.length));
        ranges.push(r);
      } catch {
        // stale offsets after a re-render: skip this page
      }
    }
    return { ranges, pages };
  }

  /** A text layer position (node, offset) → { page, item, offset }. */
  locateNode(
    node: Node,
    offset: number,
  ): { page: number; item: number; offset: number } | undefined {
    const span = (
      node.nodeType === Node.TEXT_NODE ? node.parentElement : (node as Element)
    )?.closest<HTMLElement>('.textLayer span:not(.markedContent)');
    const pageEl = span?.closest<HTMLElement>('[data-page-number]');
    const page = Number(pageEl?.dataset.pageNumber);
    if (!span || !page) return undefined;
    const spans = this.pageSpans(page);
    const si = spans?.indexOf(span) ?? -1;
    const map = this.spanIndex.get(page);
    if (si < 0 || !map) return undefined;
    const item = map.indexOf(si);
    return item >= 0 ? { page, item, offset } : undefined;
  }
}

/** Block and offset for a (page, item, offset), for click-to-read. */
export function blockAt(
  doc: ReadingDocument,
  at: { page: number; item: number; offset: number },
): { blockId: string; offset: number } | undefined {
  for (const b of doc.blocks) {
    for (const r of b.anchors) {
      if (r.anchor.kind !== 'pdf' || r.anchor.page !== at.page || r.anchor.item !== at.item)
        continue;
      const len = r.end - r.start;
      if (at.offset >= r.anchor.offset && at.offset <= r.anchor.offset + len)
        return {
          blockId: b.id,
          offset: r.start + Math.min(len - 1, Math.max(0, at.offset - r.anchor.offset)),
        };
    }
  }
  return undefined;
}
