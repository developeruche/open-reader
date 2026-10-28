// Spike: map PDF.js text layer spans back to (page, item, offset) and highlight a word.
import * as pdfjs from 'pdfjs-dist';
import { EventBus, PDFLinkService, PDFViewer } from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';

pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL('pdfjs/pdf.worker.min.mjs');

async function run(url: string, targetPage: number, needle: string) {
  const eventBus = new EventBus();
  const linkService = new PDFLinkService({ eventBus });
  const container = document.getElementById('c') as HTMLDivElement;
  const viewer = new PDFViewer({ container, eventBus, linkService });
  linkService.setViewer(viewer);
  const t0 = performance.now();
  const doc = await pdfjs.getDocument({
    url,
    wasmUrl: chrome.runtime.getURL('pdfjs/wasm/'),
    standardFontDataUrl: chrome.runtime.getURL('pdfjs/standard_fonts/'),
    cMapUrl: chrome.runtime.getURL('pdfjs/cmaps/'),
  }).promise;
  const rendered = new Promise<void>((res) => eventBus.on('textlayerrendered', (e: { pageNumber: number }) => e.pageNumber === targetPage && res()));
  viewer.setDocument(doc);
  linkService.setDocument(doc);
  await new Promise<void>((res) => eventBus.on('pagesinit', () => res()));
  const tFirst = performance.now();
  viewer.currentPageNumber = targetPage;
  await rendered;
  const page = await doc.getPage(targetPage);
  const tc = await page.getTextContent();
  const items = tc.items.filter((i): i is (typeof tc.items)[number] & { str: string; transform: number[] } => 'str' in i);
  const itemIdx = items.findIndex((i) => i.str.includes(needle));
  const offset = items[itemIdx]!.str.indexOf(needle);
  const pageDiv = viewer.getPageView(targetPage - 1).div as HTMLDivElement;
  // PDF.js appends a span only for items with str !== '' (empty EOL items emit just <br>);
  // markedContent wrappers are spans too, so exclude them.
  const spans = [...pageDiv.querySelectorAll('.textLayer span:not(.markedContent)')] as HTMLElement[];
  const domIndex = items.slice(0, itemIdx).filter((i) => i.str !== '').length;
  const span = spans[domIndex]!;
  const range = new Range();
  range.setStart(span.firstChild!, offset);
  range.setEnd(span.firstChild!, offset + needle.length);
  CSS.highlights.set('or-word', new Highlight(range));
  span.scrollIntoView({ block: 'center' });
  const r = range.getBoundingClientRect();
  const p = pageDiv.getBoundingClientRect();
  return {
    nonEmptyItems: items.filter((i) => i.str !== '').length,
    pages: doc.numPages, firstPageMs: Math.round(tFirst - t0), items: items.length, spans: spans.length,
    itemIdx, itemStr: items[itemIdx]!.str, itemX: Math.round(items[itemIdx]!.transform[4]!),
    rangeText: range.toString(), relX: +((r.x - p.x) / p.width).toFixed(3), relY: +((r.y - p.y) / p.height).toFixed(3),
  };
}

Object.assign(window, { spikePdf: run });
document.title = 'pdf ready';
