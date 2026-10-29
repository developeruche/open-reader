/** Picks the highlight variant from the page background under the content (§3.3, §7.2). */
import type { Variant } from './highlightCss';

function parseRgb(c: string): [number, number, number, number] | undefined {
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (!m) return undefined;
  const p = (m[1] ?? '')
    .split(/[ ,/]+/)
    .filter(Boolean)
    .map(Number);
  return [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 1];
}

/** WCAG relative luminance of an sRGB colour. */
export function luminance(r: number, g: number, b: number): number {
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Effective background of an element: the first ancestor with an opaque-enough background. */
export function backgroundOf(el: Element | null, view: Window = window): [number, number, number] {
  for (let e: Element | null = el; e; e = e.parentElement) {
    const c = parseRgb(view.getComputedStyle(e).backgroundColor);
    if (c && c[3] > 0.5) return [c[0], c[1], c[2]];
  }
  return [255, 255, 255];
}

export function variantFor(el: Element | null, view: Window = window): Variant {
  const [r, g, b] = backgroundOf(el, view);
  return luminance(r, g, b) < 0.25 ? 'dark' : 'light';
}
