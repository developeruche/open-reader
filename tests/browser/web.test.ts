import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import blog from '../fixtures/web/blog.html?raw';
import dark from '../fixtures/web/dark.html?raw';
import spa from '../fixtures/web/spa.html?raw';
import type { SyncEvent } from '@/core/player/sync';
import type { ContentMessage } from '@/runtime/protocol';
import { ContentApp } from '@/web/contentApp';
import { backgroundOf, luminance, variantFor } from '@/web/contrast';
import { CursorOverlay } from '@/web/cursor';
import { extractPage, locate, rangeFor } from '@/web/extract';
import { FollowScroller } from '@/web/follow';
import { HighlightPainter } from '@/web/painter';

function load(html: string): void {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  document.head.innerHTML = doc.head.innerHTML;
  document.body.innerHTML = doc.body.innerHTML;
  document.title = doc.title;
  window.scrollTo(0, 0);
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(undefined)));

afterEach(() => {
  CSS.highlights.clear();
  document
    .querySelectorAll('open-reader-cursor, open-reader-mini, open-reader-play-here')
    .forEach((e) => e.remove());
});

describe('extraction in a real browser', () => {
  beforeEach(() => load(blog));

  it('maps sentences and words to live ranges with real rectangles', () => {
    const x = extractPage(document, 'https://fixtures.test/blog.html');
    const b = x.doc.blocks.find((q) => q.text.startsWith('A PSBT'))!;
    const s = b.sentences[1]!;
    const r = rangeFor(b, x.registry, s.start, s.end)!;
    expect(r.toString().replace(/\s+/g, ' ')).toBe(
      'Each wallet that touches it adds what it knows.',
    );
    const rects = [...r.getClientRects()];
    expect(rects.length).toBeGreaterThan(0);
    expect(rects[0]!.width).toBeGreaterThan(10);
  });

  it('locates the word under a point (caretPositionFromPoint)', () => {
    const x = extractPage(document, 'https://fixtures.test/blog.html');
    const li = document.querySelectorAll('li')[2]!;
    const r = document.createRange();
    const at = li.firstChild!.textContent!.indexOf('signer');
    r.setStart(li.firstChild!, at);
    r.setEnd(li.firstChild!, at + 6);
    const box = r.getBoundingClientRect();
    const pos = document.caretPositionFromPoint(
      box.left + box.width / 2,
      box.top + box.height / 2,
    )!;
    const loc = locate(x.doc, x.registry, pos.offsetNode, pos.offset)!;
    const block = x.doc.blocks.find((q) => q.id === loc.blockId)!;
    expect('signer'.includes(block.text.slice(loc.offset, loc.offset + 2))).toBe(true);
  });
});

describe('painter, cursor and contrast', () => {
  it('paints sentence and word highlights in both variants', () => {
    load(blog);
    const p = document.querySelector('article p')!;
    const s = document.createRange();
    s.selectNodeContents(p);
    const w = document.createRange();
    const at = p.firstChild!.textContent!.indexOf('PSBT');
    w.setStart(p.firstChild!, at);
    w.setEnd(p.firstChild!, at + 4);
    const painter = new HighlightPainter();
    painter.paint(s, w);
    expect([...CSS.highlights.get('or-word')!][0]!.toString()).toBe('PSBT');
    painter.setVariant('dark');
    expect(CSS.highlights.has('or-word')).toBe(false);
    expect([...CSS.highlights.get('or-word-dark')!][0]!.toString()).toBe('PSBT');
    painter.paint(s, undefined);
    expect(CSS.highlights.has('or-word-dark')).toBe(false);
    painter.clear();
    expect(CSS.highlights.size).toBe(0);
    const cursor = new CursorOverlay();
    cursor.setVariant('dark');
    cursor.show(w);
    cursor.show(undefined);
    expect(document.querySelector('open-reader-cursor')).not.toBeNull();
    cursor.destroy();
    expect(document.querySelector('open-reader-cursor')).toBeNull();
  });

  it('detects dark pages from the background under the text', () => {
    load(dark);
    expect(variantFor(document.querySelector('article p'))).toBe('dark');
    expect(backgroundOf(document.querySelector('article p'))).toEqual([18, 18, 18]);
    load(blog);
    document.documentElement.style.background = '';
    document.body.style.background = 'white';
    expect(variantFor(document.querySelector('article p'))).toBe('light');
    expect(luminance(255, 255, 255)).toBeCloseTo(1);
    expect(luminance(0, 0, 0)).toBe(0);
  });
});

describe('follow-scroll', () => {
  it('scrolls the sentence into the comfortable band and pauses for user scrolls', async () => {
    document.body.innerHTML = `<div style="height:3000px"></div><p id="t">Target sentence far down.</p><div style="height:3000px"></div>`;
    window.scrollTo(0, 0);
    const f = new FollowScroller(window, () => true);
    const changes: boolean[] = [];
    f.onSuspendChange((s) => changes.push(s));
    expect(f.follow(document.getElementById('t')!.getBoundingClientRect())).toBe(true);
    await frame();
    const top = document.getElementById('t')!.getBoundingClientRect().top;
    expect(top).toBeGreaterThan(innerHeight * 0.25 - 2);
    expect(top).toBeLessThan(innerHeight * 0.65);
    expect(f.follow(document.getElementById('t')!.getBoundingClientRect())).toBe(false);
    window.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    expect(f.suspended).toBe(true);
    expect(changes).toEqual([true]);
    expect(f.follow(new DOMRect(0, 5000, 10, 10))).toBe(false);
    f.resume();
    expect(f.suspended).toBe(false);
    f.enabled = false;
    expect(f.follow(new DOMRect(0, 5000, 10, 10))).toBe(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'PageDown' }));
    expect(f.suspended).toBe(true);
    f.destroy();
  });
});

describe('ContentApp', () => {
  const posted: ContentMessage[] = [];
  const started = (
    blockId: string,
    sentenceId: string,
    words: { s: number; e: number }[],
  ): SyncEvent => ({
    type: 'SEGMENT_STARTED',
    sessionId: 's',
    segmentId: `${sentenceId}#0`,
    sentenceId,
    blockId,
    sentenceIndex: 0,
    words: words.map((w, i) => ({
      start: i * 0.2,
      end: i * 0.2 + 0.2,
      displayStart: w.s,
      displayEnd: w.e,
      sentenceWord: i,
    })),
    mediaStartEpochMs: Date.now(),
    rate: 1,
  });

  beforeEach(() => {
    posted.length = 0;
  });

  it('extracts, paints the playing word, follows keys and Alt+click', async () => {
    load(blog);
    const app = new ContentApp((m) => posted.push(m));
    app.handle({ type: 'EXTRACT', fromSelection: false, fromHere: false });
    const docMsg = posted.find((m) => m.type === 'DOC');
    expect(docMsg?.type === 'DOC' && docMsg.doc.blocks.length).toBeGreaterThan(5);
    const doc = app.extraction!.doc;
    app.handle({
      type: 'SESSION',
      session: { active: true, docId: doc.id, state: 'playing', rate: 1 },
    });
    expect(document.querySelector('open-reader-mini')).not.toBeNull();
    const b = doc.blocks.find((q) => q.text.startsWith('A PSBT'))!;
    const s = b.sentences[0]!;
    app.handle({
      type: 'SYNC',
      event: started(
        b.id,
        s.id,
        s.words.map((w) => ({ s: w.start, e: w.end })),
      ),
    });
    await frame();
    await frame();
    expect([...CSS.highlights.get('or-word')!][0]!.toString()).toBe('A');
    expect([...CSS.highlights.get('or-sentence')!][0]!.toString()).toBe(
      b.text.slice(s.start, s.end),
    );
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: '=', bubbles: true }));
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(
      posted
        .filter((m) => m.type === 'COMMAND')
        .map((m) => (m.type === 'COMMAND' ? m.command.type : '')),
    ).toEqual(['NEXT_SENTENCE', 'SET_SPEED', 'STOP']);
    const p = document.querySelectorAll('article p')[1]!;
    const r = p.getBoundingClientRect();
    document.dispatchEvent(
      new MouseEvent('click', {
        altKey: true,
        clientX: r.left + 30,
        clientY: r.top + 8,
        bubbles: true,
      }),
    );
    const seek = posted.find((m) => m.type === 'SEEK');
    expect(seek?.type === 'SEEK' && seek.at.blockId).toBeTruthy();
    app.handle({ type: 'SYNC', event: { type: 'PAUSED', sessionId: 's', mediaTime: 0.1 } });
    app.handle({ type: 'SESSION', session: { active: false, docId: null, state: null, rate: 1 } });
    expect(document.querySelector('open-reader-mini')).toBeNull();
    expect(CSS.highlights.size).toBe(0);
  });

  it('starts from the right-clicked point and reads selections', () => {
    load(blog);
    const app = new ContentApp((m) => posted.push(m));
    const li = document.querySelectorAll('li')[1]!.getBoundingClientRect();
    document.dispatchEvent(
      new MouseEvent('contextmenu', { clientX: li.left + 10, clientY: li.top + 5, bubbles: true }),
    );
    app.handle({ type: 'EXTRACT', fromSelection: false, fromHere: true });
    const d = posted.at(-1);
    expect(d?.type === 'DOC' && d.startAt?.blockId).toBeTruthy();
    const range = document.createRange();
    range.selectNodeContents(document.querySelector('article p')!);
    getSelection()!.removeAllRanges();
    getSelection()!.addRange(range);
    app.handle({ type: 'EXTRACT', fromSelection: true });
    const sel = posted.at(-1);
    expect(sel?.type === 'DOC' && sel.doc.blocks[0]!.text.startsWith('A PSBT')).toBe(true);
    getSelection()!.removeAllRanges();
    document.body.innerHTML = '';
    app.handle({ type: 'EXTRACT', fromSelection: false });
    expect(posted.at(-1)?.type).toBe('NO_CONTENT');
  });

  it('re-maps after an SPA re-render and gives up with a note when the text changes', async () => {
    load(spa);
    // The fixture's script does not run through innerHTML: render by hand.
    const render = (extra = '') => {
      document.getElementById('app')!.innerHTML =
        `<article><h1>Live notes</h1><p>This page is rendered by a small script, like a single page app.</p><p>Every few seconds the framework throws the article away.</p><p>The words stay the same, but every text node is new${extra}.</p></article>`;
    };
    render();
    const app = new ContentApp((m) => posted.push(m));
    app.handle({ type: 'EXTRACT', fromSelection: false });
    render();
    expect(app.remapIfNeeded()).toBe(true);
    expect(app.extraction!.registry.allConnected()).toBe(true);
    render(' and different');
    expect(app.remapIfNeeded()).toBe(false);
    expect(posted.at(-1)?.type).toBe('NOTE');
    expect(app.pageHighlightLost).toBe(true);
  });
});
