import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Navigator } from '@/core/document/positions';
import { extractPage, extractSelection, locate, rangeFor } from '@/web/extract';
import { BlockTextBuilder } from '@/web/textBuilder';

function load(name: string): Document {
  const html = readFileSync(`tests/fixtures/web/${name}`, 'utf8');
  document.open();
  document.write(html);
  document.close();
  return document;
}

describe('BlockTextBuilder', () => {
  it('collapses whitespace across nodes and keeps exact anchors', () => {
    const b = new BlockTextBuilder();
    b.append('  Hello   ', 1);
    b.append('\nbrave', 2, { code: true });
    b.append(' world ', 3);
    expect(b.text).toBe('Hello brave world');
    expect(b.anchors).toEqual([
      { start: 0, end: 5, anchor: { kind: 'dom', nodeRef: 1, offset: 2 } },
      { start: 6, end: 11, anchor: { kind: 'dom', nodeRef: 2, offset: 1 } },
      { start: 12, end: 17, anchor: { kind: 'dom', nodeRef: 3, offset: 1 } },
    ]);
    expect(b.marks).toEqual([{ start: 6, end: 11, kind: 'code' }]);
    b.separator(', ');
    b.append('x', undefined);
    expect(b.text).toBe('Hello brave world, x');
  });
});

describe('extractPage', () => {
  it('reads the article of the blog fixture and maps every node to the live page', () => {
    const x = extractPage(load('blog.html'), 'https://fixtures.test/blog.html#top');
    expect(x.mode).toBe('article');
    expect(x.mapped).toBe(x.total);
    const texts = x.doc.blocks.map((b) => b.text);
    expect(texts).toContain(
      'A PSBT is a container for a transaction that is not finished yet. Each wallet that touches it adds what it knows. Nobody has to trust anybody else with private keys.',
    );
    expect(texts.some((t) => t.includes('Copyright'))).toBe(false);
    expect(texts.some((t) => t.includes('Home'))).toBe(false);
    expect(x.doc.blocks.filter((b) => b.type === 'listItem')).toHaveLength(4);
    expect(x.doc.blocks.find((b) => b.type === 'heading')?.level).toBe(2);
    expect(x.doc.id).toBe(extractPage(document, 'https://fixtures.test/blog.html').doc.id);
  });

  it('marks inline code, skips code blocks by type and maps ranges back to the DOM', () => {
    const x = extractPage(load('docs.html'), 'https://fixtures.test/docs.html');
    const call = x.doc.blocks.find((b) => b.text.startsWith('Call walletProcessPsbt'))!;
    expect(call.marks).toEqual([{ start: 5, end: 22, kind: 'code' }]);
    expect(
      x.doc.blocks.some((b) => b.type === 'code' && b.text.includes('walletprocesspsbt')),
    ).toBe(true);
    const r = rangeFor(call, x.registry, 5, 22)!;
    expect(r.toString()).toBe('walletProcessPsbt');
    const s = call.sentences[1]!;
    expect(rangeFor(call, x.registry, s.start, s.end)!.toString()).toBe(
      call.text.slice(s.start, s.end),
    );
  });

  it('turns a references section into skippable reference blocks and keeps citations as text', () => {
    const x = extractPage(load('wiki.html'), 'https://fixtures.test/wiki.html');
    const refs = x.doc.blocks.filter((b) => b.type === 'reference');
    expect(refs.map((b) => b.text)).toEqual(expect.arrayContaining(['Wallet survey, 2020.']));
    expect(
      x.doc.blocks.find((b) => b.text.startsWith('A partially signed transaction is'))?.text,
    ).toContain('[1]');
    expect(
      new Navigator({
        ...x.doc,
        blocks: x.doc.blocks.map((b) => (b.type === 'reference' ? { ...b, skip: 'reference' } : b)),
      }).sentences.every((s) => s.block.type !== 'reference'),
    ).toBe(true);
  });

  it('reads tables row by row', () => {
    const x = extractPage(load('long.html'), 'https://fixtures.test/long.html');
    const rows = x.doc.blocks.filter((b) => b.type === 'tableRow').map((b) => b.text);
    expect(rows).toContain('Fast, 25 sat/vB, 3,525 sats');
  });

  it('falls back to visible text when there is no article', () => {
    document.body.innerHTML =
      '<nav>Menu</nav><div><p>Short note one.</p><p hidden>Hidden.</p><p>Short note two.</p></div><footer>Foot</footer>';
    const x = extractPage(document, 'https://x.test/');
    expect(x.mode).toBe('visible');
    expect(x.doc.blocks.map((b) => b.text)).toEqual(['Short note one.', 'Short note two.']);
  });

  it('locates a clicked text position in its block', () => {
    const x = extractPage(load('blog.html'), 'https://fixtures.test/blog.html');
    const li = [...document.querySelectorAll('li')][2]!;
    const node = li.firstChild!;
    const loc = locate(x.doc, x.registry, node, 5)!;
    const block = x.doc.blocks.find((b) => b.id === loc.blockId)!;
    expect(block.text.slice(loc.offset, loc.offset + 6)).toBe('signer');
    expect(locate(x.doc, x.registry, document.body, 0)).toBeUndefined();
  });
});

describe('extractSelection', () => {
  it('reads only the selected text, mapped to its nodes', () => {
    document.body.innerHTML =
      '<article><p>A PSBT is a container for a transaction.</p><p>Next.</p></article>';
    const p = document.querySelector('article p')!;
    const r = document.createRange();
    r.setStart(p.firstChild!, 2);
    r.setEnd(p.firstChild!, 20);
    const x = extractSelection(document, r, 'https://fixtures.test/blog.html');
    expect(x.mode).toBe('selection');
    expect(x.doc.blocks.map((b) => b.text)).toEqual(['PSBT is a containe']);
    expect(rangeFor(x.doc.blocks[0]!, x.registry, 0, 4)!.toString()).toBe('PSBT');
  });
});
