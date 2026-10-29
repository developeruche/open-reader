// Injected on demand by the background (chrome.scripting), never declared statically.
// M5: minimal extraction (headings, paragraphs, list items). M8 replaces it with Readability and
// live-DOM mapping, highlights, the cursor and follow-scroll.
import { buildBlock } from '@/core/document/build';
import type { Block, BlockType, ReadingDocument } from '@/core/document/model';
import { sha256Hex } from '@/core/util/sha256';
import { connectWithRetry } from '@/platform/ports';
import { PORT, type ContentMessage, type ContentUpdate } from '@/runtime/protocol';

const TYPES: Record<string, BlockType> = {
  P: 'paragraph',
  LI: 'listItem',
  BLOCKQUOTE: 'quote',
  PRE: 'code',
  FIGCAPTION: 'caption',
};

function extract(fromSelection: boolean): ReadingDocument | null {
  const url = location.href.split('#')[0] ?? location.href;
  const selection = fromSelection ? (getSelection()?.toString().trim() ?? '') : '';
  let blocks: Block[];
  if (selection) {
    blocks = selection
      .split(/\n\s*\n/)
      .map((t, i) =>
        buildBlock({ id: `s${i}`, type: 'paragraph', text: t.replace(/\s+/g, ' ').trim() }),
      )
      .filter((b) => b.text);
  } else {
    const els = [
      ...document.body.querySelectorAll<HTMLElement>(
        'h1,h2,h3,h4,h5,h6,p,li,blockquote,pre,figcaption',
      ),
    ].filter(
      (el) =>
        !el.closest('nav,header,footer,aside,[hidden],[aria-hidden=true]') &&
        !el.parentElement?.closest('p,li,blockquote,pre,figcaption'),
    );
    blocks = els
      .map((el, i) => {
        const h = /^H([1-6])$/.exec(el.tagName);
        const text = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
        return buildBlock({
          id: `b${i}`,
          type: h ? 'heading' : (TYPES[el.tagName] ?? 'paragraph'),
          level: h ? Number(h[1]) : undefined,
          text,
        });
      })
      .filter((b) => b.text);
  }
  if (!blocks.length) return null;
  return {
    id: sha256Hex(selection ? `${url}#selection:${sha256Hex(selection)}` : url),
    kind: 'web',
    title: document.title,
    lang: 'en',
    blocks,
  };
}

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    const g = globalThis as { __openReaderContent?: boolean };
    if (g.__openReaderContent) return;
    g.__openReaderContent = true;
    const port = connectWithRetry<ContentUpdate, ContentMessage>({
      name: PORT.content,
      onMessage(msg) {
        if (msg.type !== 'EXTRACT') return;
        const doc = extract(msg.fromSelection);
        const url = location.href;
        port.post(
          doc
            ? { type: 'DOC', doc, url, startSentence: msg.fromSelection ? 0 : -1 }
            : { type: 'NO_CONTENT', url },
        );
      },
    });
  },
});
