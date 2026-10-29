/**
 * PDF reading-order analysis (PLAN.md §8.3). Pure: input is each page's text items (as from
 * `page.getTextContent()`), output is blocks with PDF anchors. Item indices count every str-bearing
 * item, matching the text layer mapping (ADR 0007).
 */
import { buildBlock } from '@/core/document/build';
import type { AnchorRun, Block, BlockType, SkipReason } from '@/core/document/model';

export interface PdfItem {
  str: string;
  /** [a, b, c, d, e, f]: e/f are the baseline origin in PDF units (y grows upwards). */
  transform: number[];
  width: number;
  height?: number;
  hasEOL?: boolean;
  fontName?: string;
}

export interface PdfPageText {
  page: number;
  width: number;
  height: number;
  items: PdfItem[];
}

interface Item {
  page: number;
  index: number;
  str: string;
  x: number;
  y: number;
  size: number;
  width: number;
  bold: boolean;
}

export interface Line {
  page: number;
  items: Item[];
  x0: number;
  x1: number;
  y: number;
  size: number;
  text: string;
  bold: boolean;
  /** Column index on its page; -1 for lines spanning the gutter. */
  column: number;
  zone: 'header' | 'footer' | 'body';
}

export interface LayoutOptions {
  /** Fraction of the page height treated as header/footer zones. */
  marginZone?: number;
  /** Fraction of pages a header/footer must repeat on. */
  repeatRatio?: number;
}

export interface LayoutResult {
  blocks: Block[];
  /** Lines per page in reading order, for the debug overlay. */
  order: { page: number; block: number; x0: number; y: number; x1: number }[];
  /** Pages with no text items (OCR candidates, M13). */
  emptyPages: number[];
}

const quantile = (xs: number[], q: number) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * q))] ?? 0;
};
const median = (xs: number[]) => quantile(xs, 0.5);

function toItems(p: PdfPageText): Item[] {
  const out: Item[] = [];
  p.items.forEach((it, index) => {
    if (!it.str.trim()) return;
    const t = it.transform;
    const size = Math.hypot(t[2] ?? 0, t[3] ?? 0) || Math.abs(t[3] ?? 0) || 10;
    out.push({
      page: p.page,
      index,
      str: it.str,
      x: t[4] ?? 0,
      y: t[5] ?? 0,
      size,
      width: it.width,
      bold: /bold|black|heavy|semibold/i.test(it.fontName ?? ''),
    });
  });
  return out;
}

/**
 * x positions splitting columns (§8.3.3): bands inside the text area where body text coverage is
 * under a quarter of the typical coverage, i.e. mostly vertical whitespace.
 */
export function findGutters(all: Item[], pageHeight = Infinity, zone = 0.07): number[] {
  // Margin zones hold headers, footers and centred page numbers that sit in the gutter.
  const items = Number.isFinite(pageHeight)
    ? all.filter((i) => i.y > pageHeight * zone && i.y < pageHeight * (1 - zone))
    : all;
  if (items.length < 6) return [];
  const minX = Math.min(...items.map((i) => i.x));
  const maxX = Math.max(...items.map((i) => i.x + i.width));
  if (maxX - minX < 100) return [];
  const bins = Math.ceil(maxX - minX);
  const covered = new Float64Array(bins);
  for (const it of items) {
    for (
      let b = Math.max(0, Math.floor(it.x - minX));
      b < Math.min(bins, Math.ceil(it.x + it.width - minX));
      b++
    )
      covered[b] = (covered[b] ?? 0) + it.size * 1.4;
  }
  // A gutter is nearly empty compared with typical text (columns may differ in length).
  const typical = median([...covered].filter((c) => c > 0));
  if (typical <= 0) return [];
  const gutters: number[] = [];
  const minWidth = Math.max(8, median(items.map((i) => i.size)) * 0.8);
  let run = -1;
  for (let b = 0; b <= bins; b++) {
    const free = b < bins && (covered[b] ?? 0) <= typical * 0.25;
    if (free && run < 0) run = b;
    if (!free && run >= 0) {
      const inside = run > (maxX - minX) * 0.15 && b < (maxX - minX) * 0.85;
      if (b - run >= minWidth && inside) gutters.push(minX + (run + b) / 2);
      run = -1;
    }
  }
  return gutters;
}

function buildLines(items: Item[], gutters: number[]): Line[] {
  const colOf = (it: Item) => {
    let c = 0;
    for (const g of gutters) if (it.x >= g) c++;
    return c;
  };
  const crosses = (it: Item) => gutters.some((g) => it.x < g && it.x + it.width > g);
  const sorted = [...items].sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const column = crosses(it) ? -1 : colOf(it);
    const line = lines.find(
      (l) =>
        l.page === it.page &&
        Math.abs(l.y - it.y) < 0.5 * Math.max(l.size, it.size) &&
        (l.column === column || l.column === -1 || column === -1),
    );
    if (line) {
      line.items.push(it);
      if (column === -1) line.column = -1;
      line.size = Math.max(line.size, it.size);
    } else
      lines.push({
        page: it.page,
        items: [it],
        x0: 0,
        x1: 0,
        y: it.y,
        size: it.size,
        text: '',
        bold: it.bold,
        column,
        zone: 'body',
      });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    l.x0 = l.items[0]?.x ?? 0;
    const last = l.items.at(-1);
    l.x1 = (last?.x ?? 0) + (last?.width ?? 0);
    l.bold = l.items.every((i) => i.bold);
    l.text = lineText(l).text;
  }
  return lines;
}

/** Text of a line plus, per character, its (item, offset) source (null = inserted space). */
function lineText(l: Line): { text: string; src: ({ item: number; offset: number } | null)[] } {
  let text = '';
  const src: ({ item: number; offset: number } | null)[] = [];
  l.items.forEach((it, k) => {
    const prev = l.items[k - 1];
    if (prev) {
      const gap = it.x - (prev.x + prev.width);
      if (gap > 0.25 * it.size && !text.endsWith(' ') && !it.str.startsWith(' ')) {
        text += ' ';
        src.push(null);
      }
    }
    for (let i = 0; i < it.str.length; i++) {
      text += it.str[i];
      src.push({ item: it.index, offset: i });
    }
  });
  return { text, src };
}

/** Orders a page: full-width lines split the page into bands; inside a band, columns left to right. */
function orderPage(lines: Line[]): Line[] {
  const byY = [...lines].sort((a, b) => b.y - a.y);
  const out: Line[] = [];
  let band: Line[] = [];
  const flush = () => {
    const cols = [...new Set(band.map((l) => l.column))].sort((a, b) => a - b);
    for (const c of cols) out.push(...band.filter((l) => l.column === c).sort((a, b) => b.y - a.y));
    band = [];
  };
  for (const l of byY) {
    if (l.column === -1) {
      flush();
      out.push(l);
    } else band.push(l);
  }
  flush();
  return out;
}

const digitNorm = (s: string) => s.replace(/\d+/g, '#').replace(/\s+/g, ' ').trim().toLowerCase();
const PAGE_NUMBER = /^(page\s+)?\d+(\s+(of|\/)\s+\d+)?$/i;
const REFERENCES = /^(references|bibliography|works cited)$/i;
const CAPTION = /^(figure|fig\.|table)\s+\d+/i;
/** Lines that start a list or reference entry: "[1]", "1.", "a)", bullets. */
const ITEM_START = /^(\[\d+\]|\d{1,3}[.)]\s|[a-z][.)]\s|[•▪◦●‣–-]\s)/;

export function analyzeLayout(pages: PdfPageText[], o: LayoutOptions = {}): LayoutResult {
  const zone = o.marginZone ?? 0.07;
  const repeat = o.repeatRatio ?? 0.4;
  const emptyPages: number[] = [];
  const pageLines = pages.map((p) => {
    const items = toItems(p);
    if (!items.length) emptyPages.push(p.page);
    const lines = buildLines(items, findGutters(items, p.height, zone));
    for (const l of lines) {
      if (l.y > p.height * (1 - zone)) l.zone = 'header';
      else if (l.y < p.height * zone) l.zone = 'footer';
    }
    return orderPage(lines);
  });

  // Headers and footers: margin-zone lines whose digit-normalized text repeats on ≥ 40% of pages.
  const counts = new Map<string, Set<number>>();
  for (const lines of pageLines)
    for (const l of lines) {
      if (l.zone === 'body') continue;
      const k = `${l.zone}:${digitNorm(l.text)}`;
      const s = counts.get(k) ?? new Set<number>();
      s.add(l.page);
      counts.set(k, s);
    }
  const minPages = Math.max(2, Math.ceil(pages.length * repeat));
  const skipOf = (l: Line): SkipReason | undefined => {
    if (l.zone === 'body') return undefined;
    if (PAGE_NUMBER.test(l.text.trim())) return 'pageNumber';
    if ((counts.get(`${l.zone}:${digitNorm(l.text)}`)?.size ?? 0) >= minPages)
      return 'headerFooter';
    return undefined;
  };

  const bodySizes = pageLines
    .flat()
    .filter((l) => l.zone === 'body')
    .map((l) => l.size);
  const bodySize = median(bodySizes) || 11;

  interface Draft {
    type: BlockType;
    level?: number;
    lines: Line[];
    skip?: SkipReason;
  }
  const drafts: Draft[] = [];
  for (const lines of pageLines) {
    let current: Draft | undefined;
    const gaps: number[] = [];
    for (let i = 1; i < lines.length; i++) {
      const a = lines[i - 1];
      const b = lines[i];
      if (a && b && a.column === b.column && a.zone === 'body' && b.zone === 'body')
        gaps.push(a.y - b.y);
    }
    // The common line spacing: a low quantile, since paragraph gaps can outnumber line gaps.
    const lineGap =
      quantile(
        gaps.filter((g) => g > 0),
        0.25,
      ) || bodySize * 1.35;
    for (const l of lines) {
      const skip = skipOf(l);
      const heading =
        !skip && l.size >= bodySize * 1.2 && l.text.length < 120
          ? true
          : !skip &&
            l.bold &&
            l.size >= bodySize * 0.95 &&
            l.text.length < 80 &&
            !/[.:,;]$/.test(l.text.trim());
      const startsItem = ITEM_START.test(l.text.trim());
      const type: BlockType = heading
        ? 'heading'
        : CAPTION.test(l.text.trim())
          ? 'caption'
          : startsItem
            ? 'listItem'
            : 'paragraph';
      const prev = current?.lines.at(-1);
      const continues =
        current &&
        prev &&
        !skip &&
        !current.skip &&
        (current.type === 'paragraph' || current.type === 'listItem') &&
        type === 'paragraph' &&
        prev.page === l.page &&
        prev.column === l.column &&
        prev.y - l.y > 0 &&
        prev.y - l.y <= lineGap * 1.5 &&
        Math.abs(prev.size - l.size) <= prev.size * 0.15;
      if (continues && current) current.lines.push(l);
      else {
        current = {
          type,
          level: heading ? (l.size >= bodySize * 1.6 ? 1 : 2) : undefined,
          lines: [l],
          skip,
        };
        drafts.push(current);
      }
    }
  }

  // A paragraph cut by a page or column break continues on the next page/column when it doesn't
  // end a sentence and the next line starts in lowercase.
  const merged: Draft[] = [];
  for (const d of drafts) {
    const prev = merged.at(-1);
    const prevText = prev?.lines.at(-1)?.text.trim() ?? '';
    const first = d.lines[0]?.text.trim() ?? '';
    if (
      prev &&
      prev.type === 'paragraph' &&
      d.type === 'paragraph' &&
      !prev.skip &&
      !d.skip &&
      !/[.!?:"”]$/.test(prevText) &&
      /^[a-z]/.test(first)
    )
      prev.lines.push(...d.lines);
    else merged.push(d);
  }

  let inReferences = false;
  const order: LayoutResult['order'] = [];
  const blocks: Block[] = merged.map((d, bi) => {
    const { text, anchors } = joinLines(d.lines);
    let type = d.type;
    if (type === 'heading') inReferences = REFERENCES.test(text.trim());
    else if (inReferences && !d.skip) type = 'reference';
    for (const l of d.lines) order.push({ page: l.page, block: bi, x0: l.x0, x1: l.x1, y: l.y });
    return buildBlock({
      id: `p${d.lines[0]?.page ?? 0}b${bi}`,
      type,
      level: d.level,
      text,
      anchors,
      skip: d.skip,
    });
  });
  return { blocks, order, emptyPages };
}

/** Joins lines into block text with anchors; dehyphenates "sig-" + "nature" (§8.3.5). */
export function joinLines(lines: Line[]): { text: string; anchors: AnchorRun[] } {
  let text = '';
  const anchors: AnchorRun[] = [];
  const push = (ch: string, page: number, s: { item: number; offset: number } | null) => {
    const at = text.length;
    text += ch;
    if (!s) return;
    const last = anchors.at(-1);
    if (
      last &&
      last.anchor.kind === 'pdf' &&
      last.anchor.page === page &&
      last.anchor.item === s.item &&
      last.end === at &&
      last.anchor.offset + (last.end - last.start) === s.offset
    )
      last.end = at + 1;
    else
      anchors.push({
        start: at,
        end: at + 1,
        anchor: { kind: 'pdf', page, item: s.item, offset: s.offset },
      });
  };
  lines.forEach((l, li) => {
    const { text: lt, src } = lineText(l);
    let chars = [...lt].map((c, i) => ({ c, s: src[i] ?? null }));
    // Trim the line's own leading/trailing spaces.
    while (chars[0]?.c === ' ') chars.shift();
    while (chars.at(-1)?.c === ' ') chars.pop();
    const next = lines[li + 1];
    const nextStart = next ? lineText(next).text.trimStart() : '';
    const hyphenated = /[a-z]-$/i.test(chars.map((x) => x.c).join('')) && /^[a-z]/.test(nextStart);
    if (hyphenated) chars = chars.slice(0, -1);
    for (const { c, s } of chars) push(c, l.page, s);
    if (next && !hyphenated) push(' ', l.page, null);
  });
  return { text, anchors };
}
