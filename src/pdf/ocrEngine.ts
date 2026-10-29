/**
 * Tesseract in a worker with bundled assets only (§8.5): worker, SIMD LSTM core and English
 * best_int data come from /tesseract/ in the extension; nothing is fetched from a CDN.
 */
import { createWorker, OEM, type Worker as TesseractWorker } from 'tesseract.js';
import type { OcrPage } from './ocr';

const url = (p: string) => new URL(p, location.origin).href;

export class OcrEngine {
  private worker: Promise<TesseractWorker> | undefined;

  private get(): Promise<TesseractWorker> {
    this.worker ??= createWorker('eng', OEM.LSTM_ONLY, {
      workerPath: url('/tesseract/worker.min.js'),
      corePath: url('/tesseract/tesseract-core-simd-lstm.wasm.js'),
      langPath: url('/tesseract/lang'),
      gzip: true,
      cacheMethod: 'none',
      // A blob worker could not importScripts extension files under the page's CSP.
      workerBlobURL: false,
    });
    return this.worker;
  }

  async recognize(canvas: HTMLCanvasElement): Promise<OcrPage> {
    const w = await this.get();
    const { data } = await w.recognize(canvas, {}, { blocks: true });
    const lines = (data.blocks ?? []).flatMap((b) =>
      b.paragraphs.flatMap((p) =>
        p.lines.map((l) => ({
          bbox: l.bbox,
          baseline: l.baseline,
          words: l.words.map((x) => ({ text: x.text, bbox: x.bbox, confidence: x.confidence })),
        })),
      ),
    );
    return { width: canvas.width, height: canvas.height, lines };
  }

  async terminate(): Promise<void> {
    const w = this.worker;
    this.worker = undefined;
    await (await w)?.terminate();
  }
}
