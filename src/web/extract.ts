/**
 * Web extraction with live-DOM mapping (PLAN.md §7.1, ADR 0006): Readability runs on a clone; the
 * clone's text nodes are mapped back to live nodes by child-index path, then by an ordered text
 * fingerprint. Without an article, the visible text of the page is read instead.
 */
import { Readability } from '@mozilla/readability';
import { buildBlock } from '@/core/document/build';
import type { Block, BlockType, ReadingDocument } from '@/core/document/model';
import { sha256Hex } from '@/core/util/sha256';
import { NodeRegistry } from './registry';
import { BlockTextBuilder } from './textBuilder';

export interface Extraction {
  doc: ReadingDocument;
  registry: NodeRegistry;
  mode: 'article' | 'visible' | 'selection';
  /** Text nodes mapped to the live page / total text nodes read. */
  mapped: number;
  total: number;
}

const BLOCK: Record<string, BlockType> = {
  P: 'paragraph',
  LI: 'listItem',
  BLOCKQUOTE: 'quote',
  PRE: 'code',
  FIGCAPTION: 'caption',
  CAPTION: 'caption',
  TR: 'tableRow',
  DT: 'paragraph',
  DD: 'paragraph',
  H1: 'heading',
  H2: 'heading',
  H3: 'heading',
  H4: 'heading',
  H5: 'heading',
  H6: 'heading',
  DIV: 'paragraph',
  SECTION: 'paragraph',
  ARTICLE: 'paragraph',
  MAIN: 'paragraph',
  TABLE: 'paragraph',
  UL: 'paragraph',
  OL: 'paragraph',
  FIGURE: 'paragraph',
  HEADER: 'paragraph',
  FOOTER: 'paragraph',
  ASIDE: 'paragraph',
  NAV: 'paragraph',
  BODY: 'paragraph',
};
/** Containers: they split blocks but do not become blocks themselves. */
const CONTAINERS = new Set([
  'DIV',
  'SECTION',
  'ARTICLE',
  'MAIN',
  'TABLE',
  'UL',
  'OL',
  'FIGURE',
  'HEADER',
  'FOOTER',
  'ASIDE',
  'NAV',
  'BODY',
  'TBODY',
  'THEAD',
  'TFOOT',
  'DL',
]);
const SKIP = new Set([
  'SCRIPT',
  'STYLE',
  'NOSCRIPT',
  'TEMPLATE',
  'SVG',
  'MATH',
  'BUTTON',
  'INPUT',
  'SELECT',
  'TEXTAREA',
  'IFRAME',
  'OBJECT',
  'CANVAS',
  'VIDEO',
  'AUDIO',
  'IMG',
]);
const VISIBLE_SKIP =
  'nav, header, footer, aside, script, style, noscript, [hidden], [aria-hidden="true"], form';
const REFERENCES = /^(references|bibliography|works cited|notes|sources|citations|footnotes)$/i;

export function canonicalUrl(href: string): string {
  return href.split('#')[0] ?? href;
}

function pathOf(node: Node, root: Node): number[] | undefined {
  const path: number[] = [];
  let n: Node | null = node;
  while (n && n !== root) {
    const parent: Node | null = n.parentNode;
    if (!parent) return undefined;
    path.unshift(Array.prototype.indexOf.call(parent.childNodes, n));
    n = parent;
  }
  return n === root ? path : undefined;
}

function resolvePath(path: number[], root: Node): Node | undefined {
  let n: Node | undefined = root;
  for (const i of path) {
    n = n?.childNodes[i];
    if (!n) return undefined;
  }
  return n;
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

interface RawBlock {
  type: BlockType;
  level?: number;
  builder: BlockTextBuilder;
  element: Element;
}

/** Walks an element tree into blocks; `mapNode` returns the live ref for a text node (or undefined). */
function collect(
  root: Element,
  mapNode: (t: Text) => number | undefined,
  opts: { visible?: boolean; range?: Range } = {},
): { blocks: RawBlock[]; total: number; mapped: number } {
  const blocks: RawBlock[] = [];
  let current: RawBlock | undefined;
  let total = 0;
  let mapped = 0;
  const flush = () => {
    if (current && current.builder.text.trim()) blocks.push(current);
    current = undefined;
  };
  const listDepth = (el: Element) => {
    let d = 0;
    for (let p = el.parentElement; p; p = p.parentElement)
      if (p.tagName === 'UL' || p.tagName === 'OL') d++;
    return d;
  };
  const visit = (node: Node, inCode: boolean, inPre: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const t = node as Text;
      let content = t.data;
      let nodeStart = 0;
      if (opts.range) {
        if (!opts.range.intersectsNode(t)) return;
        const end = opts.range.endContainer === t ? opts.range.endOffset : content.length;
        nodeStart = opts.range.startContainer === t ? opts.range.startOffset : 0;
        content = content.slice(nodeStart, end);
      }
      if (!content.trim() && !inPre) {
        current?.builder.append(content, undefined);
        return;
      }
      if (!current)
        current = {
          type: 'paragraph',
          builder: new BlockTextBuilder(),
          element: t.parentElement ?? root,
        };
      total++;
      const ref = mapNode(t);
      if (ref !== undefined) mapped++;
      current.builder.append(content, ref, { code: inCode && !inPre, preserve: false, nodeStart });
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP.has(tag)) return;
    if (opts.visible && el !== root && el.matches(VISIBLE_SKIP)) return;
    if (
      opts.visible &&
      el instanceof HTMLElement &&
      typeof el.checkVisibility === 'function' &&
      !el.checkVisibility()
    )
      return;
    if (tag === 'BR') {
      current?.builder.append(' ', undefined);
      return;
    }
    if (tag === 'TD' || tag === 'TH') {
      if (current?.type === 'tableRow') current.builder.separator(', ');
      for (const c of el.childNodes) visit(c, inCode, inPre);
      return;
    }
    const blockType = BLOCK[tag];
    if (blockType && !CONTAINERS.has(tag)) {
      flush();
      const level =
        blockType === 'heading'
          ? Number(tag.slice(1))
          : blockType === 'listItem'
            ? listDepth(el)
            : undefined;
      current = { type: blockType, level, builder: new BlockTextBuilder(), element: el };
      for (const c of el.childNodes) visit(c, inCode || tag === 'PRE', inPre || tag === 'PRE');
      flush();
      return;
    }
    if (CONTAINERS.has(tag)) {
      flush();
      for (const c of el.childNodes) visit(c, inCode, inPre);
      flush();
      return;
    }
    const code = inCode || tag === 'CODE' || tag === 'KBD' || tag === 'SAMP';
    for (const c of el.childNodes) visit(c, code, inPre);
  };
  visit(root, false, false);
  flush();
  return { blocks, total, mapped };
}

function toDocument(raw: RawBlock[], id: string, title: string): ReadingDocument {
  let refLevel: number | undefined;
  const blocks: Block[] = raw.map((b, i) => {
    let type = b.type;
    if (type === 'heading') {
      const t = norm(b.builder.text);
      if (REFERENCES.test(t)) refLevel = b.level ?? 2;
      else if (refLevel !== undefined && (b.level ?? 2) <= refLevel) refLevel = undefined;
    } else if (refLevel !== undefined) type = 'reference';
    const text = b.builder.text.replace(/\s+$/, '');
    return buildBlock({
      id: `b${i}`,
      type,
      level: b.level,
      text,
      anchors: b.builder.anchors
        .filter((a) => a.start < text.length)
        .map((a) => ({ ...a, end: Math.min(a.end, text.length) })),
      marks: b.builder.marks.filter((m) => m.start < text.length),
    });
  });
  return { id, kind: 'web', title, lang: 'en', blocks };
}

/** Extracts the reading document of a live page. */
export function extractPage(document: Document, url = document.location.href): Extraction {
  const registry = new NodeRegistry();
  const id = sha256Hex(canonicalUrl(url));
  const title = document.title || url;
  const clone = document.cloneNode(true) as Document;
  const paths = new Map<Text, number[]>();
  const walker = clone.createTreeWalker(clone.documentElement, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const p = pathOf(n, clone.documentElement);
    if (p) paths.set(n as Text, p);
  }
  let article: Element | null = null;
  try {
    const parsed = new Readability(clone, { serializer: (el) => el, charThreshold: 200 }).parse();
    article = (parsed?.content as unknown as Element | null) ?? null;
  } catch {
    article = null;
  }
  if (article && norm(article.textContent ?? '').length >= 200) {
    // Ordered fingerprint fallback over live text nodes (Readability may rebuild the DOM, ADR 0006).
    const live: Text[] = [];
    const lw = document.createTreeWalker(
      document.body ?? document.documentElement,
      NodeFilter.SHOW_TEXT,
    );
    for (let t = lw.nextNode(); t; t = lw.nextNode())
      if (t.textContent?.trim()) live.push(t as Text);
    const liveIndex = new Map(live.map((t, i) => [t, i]));
    let cursor = 0;
    const map = (t: Text): number | undefined => {
      const p = paths.get(t);
      const l = p ? resolvePath(p, document.documentElement) : undefined;
      if (l && l.nodeType === Node.TEXT_NODE && (l as Text).data === t.data) {
        cursor = (liveIndex.get(l as Text) ?? cursor - 1) + 1;
        return registry.ref(l as Text);
      }
      const want = norm(t.data);
      for (let i = cursor; i < live.length; i++) {
        const cand = live[i];
        if (cand && norm(cand.data) === want) {
          cursor = i + 1;
          return registry.ref(cand);
        }
      }
      return undefined;
    };
    const { blocks, total, mapped } = collect(article, map);
    return { doc: toDocument(blocks, id, title), registry, mode: 'article', total, mapped };
  }
  const { blocks, total, mapped } = collect(
    document.body ?? document.documentElement,
    (t) => registry.ref(t),
    { visible: true },
  );
  return { doc: toDocument(blocks, id, title), registry, mode: 'visible', total, mapped };
}

/** Extracts only the selected text, mapped to the live nodes it came from. */
export function extractSelection(
  document: Document,
  range: Range,
  url = document.location.href,
): Extraction {
  const registry = new NodeRegistry();
  const root =
    range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? (range.commonAncestorContainer as Element)
      : (range.commonAncestorContainer.parentElement ?? document.body);
  const { blocks, total, mapped } = collect(root, (t) => registry.ref(t), { range });
  const text = range.toString();
  return {
    doc: toDocument(
      blocks,
      sha256Hex(`${canonicalUrl(url)}#selection:${sha256Hex(text)}`),
      document.title,
    ),
    registry,
    mode: 'selection',
    total,
    mapped,
  };
}

/** Maps a live (text node, offset) to a block and offset, for click-to-read. */
export function locate(
  doc: ReadingDocument,
  registry: NodeRegistry,
  node: Node,
  offset: number,
): { blockId: string; offset: number } | undefined {
  const ref = registry.refOf(node);
  if (ref === undefined) return undefined;
  let best: { blockId: string; offset: number } | undefined;
  for (const b of doc.blocks) {
    for (const r of b.anchors) {
      if (r.anchor.kind !== 'dom' || r.anchor.nodeRef !== ref) continue;
      const len = r.end - r.start;
      if (offset >= r.anchor.offset && offset < r.anchor.offset + len)
        return { blockId: b.id, offset: r.start + (offset - r.anchor.offset) };
      if (offset >= r.anchor.offset + len) best = { blockId: b.id, offset: r.end - 1 };
      else if (!best) best = { blockId: b.id, offset: r.start };
    }
  }
  return best;
}

/** A live Range covering block.text[start, end), or undefined when the nodes are gone. */
export function rangeFor(
  block: Block,
  registry: NodeRegistry,
  start: number,
  end: number,
): Range | undefined {
  const runs = block.anchors.filter(
    (r) => r.end > start && r.start < end && r.anchor.kind === 'dom',
  );
  const first = runs[0];
  const last = runs.at(-1);
  if (!first || !last || first.anchor.kind !== 'dom' || last.anchor.kind !== 'dom')
    return undefined;
  const a = registry.get(first.anchor.nodeRef);
  const b = registry.get(last.anchor.nodeRef);
  if (!a || !b) return undefined;
  const range = a.ownerDocument.createRange();
  try {
    range.setStart(a, first.anchor.offset + Math.max(0, start - first.start));
    range.setEnd(b, last.anchor.offset + Math.min(last.end, end) - last.start);
  } catch {
    return undefined;
  }
  return range;
}
