import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { Navigator } from '@/core/document/positions';
import { analyzeLayout, findGutters, joinLines, type PdfPageText } from '@/pdf/layout';
import { pageText } from '@/pdf/textContent';

async function load(name: string): Promise<PdfPageText[]> {
  const data = new Uint8Array(readFileSync(`tests/fixtures/pdf/${name}.pdf`));
  const task = pdfjs.getDocument({
    data,
    standardFontDataUrl: `${process.cwd()}/node_modules/pdfjs-dist/standard_fonts/`,
  });
  const doc = await task.promise;
  const pages: PdfPageText[] = [];
  for (let p = 1; p <= doc.numPages; p++)
    pages.push(await pageText((await doc.getPage(p)) as never));
  await task.destroy();
  return pages;
}

const golden = (name: string) =>
  JSON.parse(readFileSync(`tests/fixtures/pdf/${name}.golden.json`, 'utf8')) as {
    blocks: string[];
    skipped: string[];
    probes?: [number, string][];
  };
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

describe('PDF reading order (goldens)', () => {
  for (const name of [
    'single-column',
    'two-column',
    'headers-footers',
    'hyphenation',
    'references',
  ]) {
    it(name, async () => {
      const g = golden(name);
      const r = analyzeLayout(await load(name));
      const readable = r.blocks
        .filter((b) => !b.skip && b.type !== 'reference')
        .map((b) => norm(b.text));
      expect(readable).toEqual(g.blocks.map(norm));
      const all = readable.join(' ');
      for (const s of g.skipped) if (s.length > 2) expect(all).not.toContain(s);
    });
  }

  it('maps every character back to its text item', async () => {
    const pages = await load('two-column');
    const r = analyzeLayout(pages);
    for (const b of r.blocks) {
      for (const a of b.anchors) {
        if (a.anchor.kind !== 'pdf') throw new Error('expected pdf anchors');
        const item = pages[a.anchor.page - 1]!.items[a.anchor.item]!;
        expect(item.str.slice(a.anchor.offset, a.anchor.offset + (a.end - a.start))).toBe(
          b.text.slice(a.start, a.end),
        );
      }
    }
    // The probe word lands on page 2, right column.
    const zebra = r.blocks.find((b) => b.text.includes('zebra'))!;
    const at = zebra.text.indexOf('zebra');
    const run = zebra.anchors.find((a) => a.start <= at && a.end > at)!;
    expect(run.anchor).toMatchObject({ kind: 'pdf', page: 2 });
    const item = pages[1]!.items[(run.anchor as { item: number }).item]!;
    expect(item.transform[4]).toBeGreaterThan(306);
  });

  it('dehyphenates with anchors on both fragments', async () => {
    const r = analyzeLayout(await load('hyphenation'));
    const b = r.blocks[0]!;
    const at = b.text.indexOf('signature');
    const runs = b.anchors.filter((a) => a.end > at && a.start < at + 9);
    expect(runs.length).toBe(2);
    expect(runs.map((a) => (a.anchor as { item: number }).item)).not.toEqual([
      runs[0]!.anchor,
      runs[0]!.anchor,
    ]);
  });

  it('marks headers, footers and page numbers as skipped and references as reference blocks', async () => {
    const hf = analyzeLayout(await load('headers-footers'));
    expect(hf.blocks.filter((b) => b.skip === 'headerFooter').length).toBe(5);
    expect(hf.blocks.filter((b) => b.skip === 'pageNumber').length).toBe(5);
    const refs = analyzeLayout(await load('references'));
    expect(refs.blocks.filter((b) => b.type === 'reference').map((b) => b.text)).toEqual([
      '[1] A. Chow. Partially signed transaction format. 2017.',
      '[2] Wallet survey. 2020.',
    ]);
    expect(refs.blocks.find((b) => b.type === 'caption')?.text).toMatch(/^Figure 1/);
    expect(
      new Navigator({
        id: 'x',
        kind: 'pdf',
        title: '',
        lang: 'en',
        blocks: hf.blocks,
      }).sentences.every((s) => !s.block.skip),
    ).toBe(true);
  });

  it('reports pages without text for OCR', async () => {
    const r = analyzeLayout(await load('image-only'));
    expect(r.emptyPages).toEqual([1]);
    expect(r.blocks).toEqual([]);
  });

  it('analyzes a 100-page document in well under 50 ms per page', async () => {
    const pages = await load('hundred-pages');
    const t0 = performance.now();
    const r = analyzeLayout(pages);
    const perPage = (performance.now() - t0) / pages.length;
    expect(perPage).toBeLessThan(50);
    expect(r.blocks.filter((b) => b.skip === 'pageNumber')).toHaveLength(100);
    expect(r.blocks.filter((b) => b.skip === 'headerFooter')).toHaveLength(100);
  });
});

describe('layout primitives', () => {
  it('finds no gutters in short or single-column text', () => {
    expect(findGutters([])).toEqual([]);
  });
  it('joins lines without anchors for inserted spaces', () => {
    const it0 = { page: 1, index: 0, str: 'Hello', x: 0, y: 100, size: 10, width: 25, bold: false };
    const it1 = { page: 1, index: 1, str: 'world', x: 0, y: 85, size: 10, width: 25, bold: false };
    const line = (i: typeof it0) => ({
      page: 1,
      items: [i],
      x0: 0,
      x1: 25,
      y: i.y,
      size: 10,
      text: i.str,
      bold: false,
      column: 0,
      zone: 'body' as const,
    });
    const r = joinLines([line(it0), line(it1)]);
    expect(r.text).toBe('Hello world');
    expect(r.anchors).toHaveLength(2);
  });
});
