/** Reads a PDF.js page into layout input, with the text layer's own getTextContent options. */
import type { PdfItem, PdfPageText } from './layout';

/** Must match TextLayerBuilder so item indices line up with text layer spans (ADR 0007). */
export const TEXT_CONTENT_OPTIONS = {
  includeMarkedContent: true,
  disableNormalization: true,
} as const;

interface PdfJsPage {
  pageNumber: number;
  getViewport(o: { scale: number }): { width: number; height: number };
  getTextContent(o: typeof TEXT_CONTENT_OPTIONS): Promise<{ items: unknown[] }>;
}

export async function pageText(page: PdfJsPage): Promise<PdfPageText> {
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent(TEXT_CONTENT_OPTIONS);
  const items: PdfItem[] = [];
  for (const raw of tc.items) {
    const i = raw as Partial<PdfItem> & { str?: string };
    if (typeof i.str !== 'string') continue; // marked-content markers
    items.push({
      str: i.str,
      transform: i.transform ?? [1, 0, 0, 1, 0, 0],
      width: i.width ?? 0,
      height: i.height,
      hasEOL: i.hasEOL,
      fontName: i.fontName,
    });
  }
  return { page: page.pageNumber, width: vp.width, height: vp.height, items };
}
