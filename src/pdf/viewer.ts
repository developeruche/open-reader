/**
 * PDF.js viewer wiring (PLAN.md §8.2): PDFViewer + EventBus + PDFLinkService + PDFFindController,
 * worker, WASM decoders, fonts and cMaps from the extension bundle. Text extraction feeds the
 * layout worker.
 */
import * as Comlink from 'comlink';
import * as pdfjs from 'pdfjs-dist';
import {
  EventBus,
  PDFFindController,
  PDFLinkService,
  PDFViewer,
} from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import type { ReadingDocument } from '@/core/document/model';
import type { analyzeLayout, LayoutResult, PdfPageText } from './layout';
import { pageText } from './textContent';
import { ocrScale } from './ocr';

const base = (p: string) => new URL(p, location.origin).href;
pdfjs.GlobalWorkerOptions.workerSrc = base('/pdfjs/pdf.worker.min.mjs');

export interface OutlineItem {
  title: string;
  dest: unknown;
  items: OutlineItem[];
}

export interface OpenedPdf {
  pdf: pdfjs.PDFDocumentProxy;
  pages: PdfPageText[];
  layout: LayoutResult;
  doc: ReadingDocument;
  firstPageMs: number;
  layoutMs: number;
}

export class PdfView {
  readonly eventBus = new EventBus();
  readonly linkService = new PDFLinkService({ eventBus: this.eventBus });
  readonly findController = new PDFFindController({
    eventBus: this.eventBus,
    linkService: this.linkService,
  });
  readonly viewer: PDFViewer;
  pdf: pdfjs.PDFDocumentProxy | undefined;
  private worker: Worker | undefined;
  private task: pdfjs.PDFDocumentLoadingTask | undefined;

  constructor(readonly container: HTMLDivElement) {
    this.viewer = new PDFViewer({
      container,
      eventBus: this.eventBus,
      linkService: this.linkService,
      findController: this.findController,
      removePageBorders: false,
    });
    this.linkService.setViewer(this.viewer);
  }

  on(
    name: string,
    fn: (e: { pageNumber?: number; scale?: number; source?: unknown }) => void,
  ): void {
    this.eventBus.on(name, fn);
  }

  pageDiv(page: number): HTMLElement | undefined {
    return (this.viewer.getPageView(page - 1) as { div?: HTMLElement } | undefined)?.div;
  }

  /** Opens bytes, renders page 1, extracts text and runs layout analysis in a worker. */
  async open(
    data: Uint8Array,
    id: string,
    fileName: string,
    onProgress?: (page: number, total: number) => void,
  ): Promise<OpenedPdf> {
    const t0 = performance.now();
    this.task = pdfjs.getDocument({
      data,
      wasmUrl: base('/pdfjs/wasm/'),
      standardFontDataUrl: base('/pdfjs/standard_fonts/'),
      cMapUrl: base('/pdfjs/cmaps/'),
    });
    const pdf = await this.task.promise;
    this.pdf = pdf;
    const firstRendered = new Promise<void>((res) => {
      const onPage = (e: { pageNumber?: number }) => e.pageNumber === 1 && res();
      this.eventBus.on('pagerendered', onPage);
    });
    this.viewer.setDocument(pdf);
    this.linkService.setDocument(pdf);
    await firstRendered;
    const firstPageMs = performance.now() - t0;
    const pages: PdfPageText[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      pages.push(await pageText((await pdf.getPage(p)) as never));
      onProgress?.(p, pdf.numPages);
    }
    const l0 = performance.now();
    const layout = await this.relayout(pages);
    const layoutMs = performance.now() - l0;
    const meta = (await pdf.getMetadata().catch(() => null)) as {
      info?: { Title?: string };
    } | null;
    const title = meta?.info?.Title?.trim() || fileName.replace(/\.pdf$/i, '');
    return {
      pdf,
      pages,
      layout,
      doc: { id, kind: 'pdf', title, lang: 'en', blocks: layout.blocks },
      firstPageMs,
      layoutMs,
    };
  }

  /** Layout analysis in the worker (again after OCR adds text to scanned pages). */
  private layoutApi: Comlink.Remote<{ analyzeLayout: typeof analyzeLayout }> | undefined;

  async relayout(pages: PdfPageText[]): Promise<ReturnType<typeof analyzeLayout>> {
    if (!this.layoutApi) {
      this.worker = new Worker(new URL('./layout.worker.ts', import.meta.url), { type: 'module' });
      this.layoutApi = Comlink.wrap<{ analyzeLayout: typeof analyzeLayout }>(this.worker);
    }
    return this.layoutApi.analyzeLayout(pages);
  }

  /** Renders a page to a canvas for OCR, about 2000 px wide. */
  async renderForOcr(page: number): Promise<HTMLCanvasElement> {
    const p = await this.pdf?.getPage(page);
    if (!p) throw new Error(`No page ${page}`);
    const vp = p.getViewport({ scale: ocrScale(p.getViewport({ scale: 1 }).width) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await p.render({ canvas, viewport: vp }).promise;
    return canvas;
  }

  async outline(): Promise<OutlineItem[]> {
    return ((await this.pdf?.getOutline()) ?? []) as OutlineItem[];
  }

  goTo(dest: unknown): void {
    void this.linkService.goToDestination(dest as never);
  }

  get page(): number {
    return this.viewer.currentPageNumber;
  }

  set page(n: number) {
    this.viewer.currentPageNumber = n;
  }

  /** 'page-width' | 'page-fit' | number */
  set scale(v: string | number) {
    this.viewer.currentScaleValue = String(v);
  }

  get scale(): number {
    return this.viewer.currentScale;
  }

  find(query: string, again = false, previous = false): void {
    this.eventBus.dispatch('find', {
      source: this,
      type: again ? 'again' : '',
      query,
      caseSensitive: false,
      entireWord: false,
      highlightAll: true,
      findPrevious: previous,
      matchDiacritics: false,
    });
  }

  /** Renders a thumbnail of `page` into `canvas` (lazily called by the drawer). */
  async thumbnail(page: number, canvas: HTMLCanvasElement, width = 112): Promise<void> {
    const p = await this.pdf?.getPage(page);
    if (!p) return;
    const vp1 = p.getViewport({ scale: 1 });
    const vp = p.getViewport({ scale: width / vp1.width });
    canvas.width = Math.round(vp.width);
    canvas.height = Math.round(vp.height);
    await p.render({ canvas, viewport: vp }).promise;
  }

  destroy(): void {
    this.worker?.terminate();
    void this.task?.destroy();
  }
}
