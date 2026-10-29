/**
 * OCR for scanned pages (PLAN.md §8.5, ADR 0020): Tesseract's words become text items in PDF
 * units, so layout analysis, anchors, highlighting and click-to-read work unchanged.
 */
import type { PdfItem } from './layout';

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface OcrLine {
  bbox: Box;
  /** Tesseract's baseline, from (x0, y0) to (x1, y1), in image pixels. */
  baseline?: Box;
  words: { text: string; bbox: Box; confidence: number }[];
}

export interface OcrPage {
  /** Size of the image Tesseract read, in pixels. */
  width: number;
  height: number;
  lines: OcrLine[];
}

/** Words Tesseract is this unsure of are dropped (stains, speckles, page edges). */
export const MIN_CONFIDENCE = 30;
/** Bump when the conversion changes, so cached results are recomputed. */
export const OCR_VERSION = 1;
/** Font size relative to the line box (ascender to descender). */
const SIZE_OF_LINE = 0.8;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
};

/** Words → PDF text items (y grows upwards, origin at the bottom-left of the page). */
export function ocrToItems(ocr: OcrPage, page: { width: number; height: number }): PdfItem[] {
  const sx = page.width / ocr.width;
  const sy = page.height / ocr.height;
  const items: PdfItem[] = [];
  for (const line of ocr.lines) {
    const words = line.words.filter((w) => w.text.trim() && w.confidence >= MIN_CONFIDENCE);
    if (!words.length) continue;
    // One size per line keeps the words of a line together in layout analysis.
    const heights = words.map((w) => w.bbox.y1 - w.bbox.y0);
    const size = Math.max(line.bbox.y1 - line.bbox.y0, median(heights)) * SIZE_OF_LINE * sy;
    const b = line.baseline;
    const baselineAt = (x: number) =>
      b && b.x1 !== b.x0 ? b.y0 + ((b.y1 - b.y0) * (x - b.x0)) / (b.x1 - b.x0) : line.bbox.y1;
    words.forEach((w, i) => {
      const yImg = baselineAt((w.bbox.x0 + w.bbox.x1) / 2);
      items.push({
        str: w.text.trim(),
        transform: [size, 0, 0, size, w.bbox.x0 * sx, page.height - yImg * sy],
        width: (w.bbox.x1 - w.bbox.x0) * sx,
        height: size,
        hasEOL: i === words.length - 1,
        fontName: 'OCR',
      });
    });
  }
  return items;
}

/** A scale that renders the page about 2000 px wide (≈ 200–300 dpi for common sizes). */
export function ocrScale(pageWidth: number): number {
  return Math.min(4, Math.max(1.5, 2000 / pageWidth));
}
