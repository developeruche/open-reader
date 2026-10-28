// Spike: Readability node-identity mapping + CSS Custom Highlight API on a live page.
import { Readability } from '@mozilla/readability';

function pathOf(node: Node, root: Node): number[] {
  const path: number[] = [];
  let n: Node | null = node;
  while (n && n !== root) {
    const parent: Node | null = n.parentNode;
    if (!parent) return [];
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, n));
    n = parent;
  }
  return path;
}

function resolve(path: number[], root: Node): Node | null {
  let n: Node | undefined = root;
  for (const i of path) {
    n = n?.childNodes[i];
    if (!n) return null;
  }
  return n ?? null;
}

export default defineContentScript({
  matches: ['<all_urls>'],
  registration: 'runtime',
  main() {
    const t0 = performance.now();
    const clone = document.cloneNode(true) as Document;
    const paths = new Map<Text, number[]>();
    const walker = clone.createTreeWalker(clone.documentElement, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) paths.set(n as Text, pathOf(n, clone.documentElement));
    const tPaths = performance.now();
    const article = new Readability(clone, { serializer: (el) => el }).parse();
    const tRead = performance.now();
    if (!article?.content) return void ((globalThis as Record<string, unknown>).__spike = { ok: false, reason: 'readability-null' });
    const content = article.content as unknown as Element;
    const aw = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
    let total = 0, resolved = 0, mismatched = 0, unknown = 0, fingerprinted = 0;
    const live: Text[] = [];
    // Fallback index: live text nodes in document order, outside script/style.
    const liveAll: Text[] = [];
    const lw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, { acceptNode: (t) => (t.parentElement?.closest('script,style,noscript') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    for (let t = lw.nextNode(); t; t = lw.nextNode()) liveAll.push(t as Text);
    const liveIndex = new Map<Text, number>(liveAll.map((t, i) => [t, i]));
    let cursor = 0;
    const norm = (x: string) => x.replace(/\s+/g, ' ').trim();
    for (let n = aw.nextNode(); n; n = aw.nextNode()) {
      if (!n.textContent?.trim()) continue;
      total++;
      const p = paths.get(n as Text);
      const l = p ? resolve(p, document.documentElement) : null;
      if (l && l.nodeType === Node.TEXT_NODE && l.textContent === n.textContent) { resolved++; live.push(l as Text); cursor = (liveIndex.get(l as Text) ?? cursor) + 1; continue; }
      if (p) mismatched++; else unknown++;
      // Fingerprint: next live node (in order) with the same normalized text.
      const want = norm(n.textContent);
      for (let i = cursor; i < liveAll.length; i++) {
        if (norm(liveAll[i]!.textContent ?? '') === want) { fingerprinted++; live.push(liveAll[i]!); cursor = i + 1; break; }
      }
    }
    const tMap = performance.now();
    // Pick the first live text node with a reasonable sentence, highlight sentence + 3rd word.
    const target = live.find((t) => (t.textContent ?? '').trim().split(/\s+/).length > 12);
    let highlight: Record<string, unknown> = { ok: false };
    if (target) {
      const text = target.textContent ?? '';
      const lead = text.length - text.trimStart().length;
      const sentEnd = Math.min(text.length, (text.indexOf('. ', lead + 20) + 1) || text.length);
      const seg = new Intl.Segmenter('en', { granularity: 'word' });
      const words = [...seg.segment(text.slice(lead, sentEnd))].filter((s) => s.isWordLike);
      const w = words[2]!;
      const sr = new Range(); sr.setStart(target, lead); sr.setEnd(target, sentEnd);
      const wr = new Range(); wr.setStart(target, lead + w.index); wr.setEnd(target, lead + w.index + w.segment.length);
      CSS.highlights.set('or-sentence', new Highlight(sr));
      CSS.highlights.set('or-word', new Highlight(wr));
      const style = document.createElement('style');
      style.textContent = '::highlight(or-sentence){background-color:rgba(11,11,11,.12)} ::highlight(or-word){background-color:#0b0b0b;color:#f6f4ef}';
      document.head.append(style);
      const rect = wr.getBoundingClientRect();
      wr.startContainer.parentElement?.scrollIntoView({ block: 'center' });
      highlight = { ok: CSS.highlights.has('or-word'), sentence: sr.toString().trim().slice(0, 140), word: wr.toString(), rects: wr.getClientRects().length, rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width) } };
    }
    (globalThis as Record<string, unknown>).__spike = {
      ok: true, title: article.title, total, resolved, mismatched, unknown, fingerprinted, mappedPct: +((live.length / Math.max(total, 1)) * 100).toFixed(1),
      resolvedPct: +((resolved / Math.max(total, 1)) * 100).toFixed(1),
      ms: { paths: Math.round(tPaths - t0), readability: Math.round(tRead - tPaths), map: Math.round(tMap - tRead) },
      highlight,
    };
  },
});
