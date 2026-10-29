/**
 * Our own text layer for OCR pages (§8.5): one transparent span per recognized word, positioned in
 * page percentages and sized with PDF.js's `--total-scale-factor`, so it follows zoom. The
 * highlight painter and click-to-read find it like PDF.js's own `.textLayer`.
 */
import type { PdfItem } from './layout';

export const OCR_LAYER = 'or-ocr';
const FONT = 'sans-serif';
let measure: CanvasRenderingContext2D | null | undefined;

function textWidth(text: string, size: number): number {
  measure ??= document.createElement('canvas').getContext('2d');
  if (!measure) return text.length * size * 0.5;
  measure.font = `${size}px ${FONT}`;
  return measure.measureText(text).width || 1;
}

export function renderOcrLayer(
  pageDiv: HTMLElement,
  items: PdfItem[],
  page: { width: number; height: number },
): void {
  pageDiv.querySelector(`.${OCR_LAYER}`)?.remove();
  const layer = document.createElement('div');
  layer.className = `textLayer ${OCR_LAYER}`;
  layer.dataset.orOcr = 'true';
  for (const it of items) {
    if (!it.str) continue;
    const size = Math.abs(it.transform[3] ?? 10);
    const x = it.transform[4] ?? 0;
    const baseline = it.transform[5] ?? 0;
    const span = document.createElement('span');
    span.textContent = it.str;
    span.style.left = `${(x / page.width) * 100}%`;
    // Spans are positioned by their top; the baseline sits about 0.8 em below it.
    span.style.top = `${((page.height - baseline - size * 0.8) / page.height) * 100}%`;
    span.style.fontSize = `calc(var(--total-scale-factor, 1) * ${size}px)`;
    span.style.fontFamily = FONT;
    span.style.transform = `scaleX(${it.width / textWidth(it.str, size)})`;
    layer.append(span);
  }
  pageDiv.append(layer);
}
