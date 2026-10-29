import { beforeEach, describe, expect, it } from 'vitest';
import type { Block, ReadingDocument } from '@/core/document/model';
import type { PdfPageText } from '@/pdf/layout';
import { blockAt, TextLayerMap } from '@/pdf/textLayerMap';

const item = (str: string) => ({ str, transform: [1, 0, 0, 1, 0, 0], width: 10 });

const pages: PdfPageText[] = [
  { page: 1, width: 600, height: 800, items: [item('Hello '), item(''), item('world.')] },
  { page: 2, width: 600, height: 800, items: [item('Next page')] },
];

// "Hello world. Next page" spans two pages; the empty item has no span.
const block: Block = {
  id: 'b1',
  type: 'paragraph',
  text: 'Hello world. Next page',
  anchors: [
    { start: 0, end: 6, anchor: { kind: 'pdf', page: 1, item: 0, offset: 0 } },
    { start: 6, end: 12, anchor: { kind: 'pdf', page: 1, item: 2, offset: 0 } },
    { start: 13, end: 22, anchor: { kind: 'pdf', page: 2, item: 0, offset: 0 } },
  ],
  sentences: [],
};

function renderPage(n: number, spans: string[]): HTMLElement {
  const div = document.createElement('div');
  div.dataset.pageNumber = String(n);
  const layer = document.createElement('div');
  layer.className = 'textLayer';
  for (const s of spans) {
    const span = document.createElement('span');
    span.textContent = s;
    layer.append(span);
  }
  div.append(layer);
  document.body.append(div);
  return div;
}

describe('TextLayerMap', () => {
  let divs: Map<number, HTMLElement>;
  let map: TextLayerMap;

  beforeEach(() => {
    document.body.innerHTML = '';
    divs = new Map([
      [1, renderPage(1, ['Hello ', 'world.'])],
      [2, renderPage(2, ['Next page'])],
    ]);
    map = new TextLayerMap(pages, (p) => divs.get(p));
  });

  it('maps items to spans, skipping empty items', () => {
    expect(map.textNode(1, 0)?.data).toBe('Hello ');
    expect(map.textNode(1, 1)).toBeUndefined();
    expect(map.textNode(1, 2)?.data).toBe('world.');
    expect(map.textNode(3, 0)).toBeUndefined();
  });

  it('builds one range per page', () => {
    const { ranges, pages: on } = map.ranges(block, 0, 22);
    expect(on).toEqual([1, 2]);
    expect(ranges.map((r) => r.toString())).toEqual(['Hello world.', 'Next page']);
    expect(map.ranges(block, 6, 11).ranges[0]?.toString()).toBe('world');
  });

  it('omits pages whose text layer is not rendered', () => {
    divs.delete(2);
    const { ranges, pages: on } = map.ranges(block, 0, 22);
    expect(on).toEqual([1, 2]);
    expect(ranges).toHaveLength(1);
  });

  it('re-reads spans after invalidate', () => {
    expect(map.textNode(2, 0)?.data).toBe('Next page');
    divs.get(2)?.remove();
    divs.set(2, renderPage(2, ['Re-rendered']));
    map.invalidate(2);
    expect(map.textNode(2, 0)?.data).toBe('Re-rendered');
  });

  it('locates a text node back to page, item and offset', () => {
    const t = map.textNode(1, 2);
    expect(t && map.locateNode(t, 3)).toEqual({ page: 1, item: 2, offset: 3 });
    expect(map.locateNode(document.body, 0)).toBeUndefined();
  });
});

describe('blockAt', () => {
  const doc = { blocks: [block] } as unknown as ReadingDocument;

  it('finds the block offset for a PDF position', () => {
    expect(blockAt(doc, { page: 1, item: 2, offset: 2 })).toEqual({ blockId: 'b1', offset: 8 });
    expect(blockAt(doc, { page: 2, item: 0, offset: 0 })).toEqual({ blockId: 'b1', offset: 13 });
    expect(blockAt(doc, { page: 1, item: 1, offset: 0 })).toBeUndefined();
  });
});
