import { describe, expect, it } from 'vitest';
import { analyzeLayout } from '@/pdf/layout';
import { MIN_CONFIDENCE, ocrScale, ocrToItems, type OcrPage } from '@/pdf/ocr';

/** A fake Tesseract result: words laid out on lines of an image twice the page size. */
function scan(lines: string[][], o: { lineHeight?: number; top?: number } = {}): OcrPage {
  const lh = o.lineHeight ?? 40;
  let y = o.top ?? 160;
  return {
    width: 1224,
    height: 1584,
    lines: lines.map((words) => {
      let x = 144;
      const ws = words.map((text) => {
        const w = {
          text,
          bbox: { x0: x, y0: y, x1: x + text.length * 16, y1: y + 30 },
          confidence: 90,
        };
        x = w.bbox.x1 + 14;
        return w;
      });
      const line = {
        bbox: { x0: 144, y0: y, x1: x, y1: y + 34 },
        baseline: { x0: 144, y0: y + 26, x1: x, y1: y + 27 },
        words: ws,
      };
      y += lh;
      return line;
    }),
  };
}

describe('ocrToItems', () => {
  it('maps word boxes to PDF items on a shared baseline per line', () => {
    const items = ocrToItems(
      scan([
        ['Signing', 'with', 'wallets'],
        ['A', 'second', 'line'],
      ]),
      { width: 612, height: 792 },
    );
    expect(items.map((i) => i.str)).toEqual(['Signing', 'with', 'wallets', 'A', 'second', 'line']);
    const [first] = items;
    expect(first?.transform[4]).toBeCloseTo(72);
    // Baseline at image y 186.x of 1584 → PDF y = 792 − 93.x.
    expect(first?.transform[5]).toBeCloseTo(792 - 186.03 / 2, 0);
    expect(new Set(items.slice(0, 3).map((i) => i.transform[3])).size).toBe(1);
    expect(items[2]?.hasEOL).toBe(true);
    expect(items[1]?.width).toBeCloseTo((4 * 16) / 2);
  });

  it('drops unsure and empty words', () => {
    const page = scan([['keep', 'noise', ' ']]);
    const words = page.lines[0]?.words ?? [];
    if (words[1]) words[1].confidence = MIN_CONFIDENCE - 1;
    expect(ocrToItems(page, { width: 612, height: 792 }).map((i) => i.str)).toEqual(['keep']);
    expect(ocrToItems({ width: 10, height: 10, lines: [] }, { width: 5, height: 5 })).toEqual([]);
  });

  it('feeds layout analysis: lines join into a paragraph with spaces between words', () => {
    const items = ocrToItems(
      scan([
        ['A', 'partially', 'signed', 'transaction'],
        ['travels', 'between', 'wallets.'],
      ]),
      { width: 612, height: 792 },
    );
    const layout = analyzeLayout([{ page: 1, width: 612, height: 792, items }]);
    expect(layout.emptyPages).toEqual([]);
    expect(layout.blocks.map((b) => b.text)).toEqual([
      'A partially signed transaction travels between wallets.',
    ]);
    const anchor = layout.blocks[0]?.anchors[0]?.anchor;
    expect(anchor).toMatchObject({ kind: 'pdf', page: 1, item: 0 });
  });

  it('renders pages at about 2000 px for recognition', () => {
    expect(ocrScale(612)).toBeCloseTo(3.27, 2);
    expect(ocrScale(100)).toBe(4);
    expect(ocrScale(5000)).toBe(1.5);
  });
});
