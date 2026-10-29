# 0020: Offline OCR for scanned PDFs (M13)

## Decisions

- **Engine:** tesseract.js 7.0.0 (Apache-2.0) in its own worker. Every file is bundled under
  `/tesseract/`, and the paths are pinned so its CDN defaults never apply:
  - `worker.min.js`;
  - the SIMD LSTM core `tesseract-core-simd-lstm.wasm.js` (3.9 MB; every supported Chrome has
    WASM SIMD, so the other core variants are not shipped);
  - English `4.0.0_best_int` traineddata (2.95 MB gz, from `@tesseract.js-data/eng`).

  `workerBlobURL: false` (a blob worker cannot import extension files under the page CSP), and
  `cacheMethod: 'none'` (the data is local already). The OCR assets add 7 MB to the build.

- **Pipeline:** pages without text items (`layout.emptyPages`) are rendered about 2,000 px wide and
  recognized in page order.
  - Each word becomes a `PdfItem` in PDF units (`src/pdf/ocr.ts`). The y position comes from
    Tesseract's line baseline, and every word on a line gets one shared size, so layout keeps lines
    together.
  - Words under 30% confidence are dropped.
  - Layout analysis runs again over all pages, so reading order, headers/footers, blocks and
    anchors work exactly as for born-digital text.
- **Text layer:** our own `.textLayer.or-ocr` overlay, one transparent span per word, positioned
  in page percentages, sized with PDF.js's `--total-scale-factor` and stretched to the word's
  width. PDF.js's text-layer styles apply to it. `TextLayerMap` prefers it over PDF.js's empty
  layer, so highlighting, the cursor and click-to-read need no special cases. It is rebuilt on
  every `textlayerrendered`, because PDF.js discards page contents outside its render buffer.
- **Progress and reading:** pages with real text can be read at once. A floating status shows
  "Recognizing text on page n… (k of N)". When OCR finishes, the document is re-read at the same
  position (playing if it was). A fully scanned PDF loads its player after OCR.
- **Cache:** recognized items are stored per document page in IndexedDB
  (`open-reader` v4 → `ocr`, key `docId:page:OCR_VERSION`). Reopening skips recognition, and
  bumping `OCR_VERSION` invalidates old results. The worker is terminated after each run.
- **Fix found on the way:** `PdfView` wrapped its layout worker with a new Comlink proxy on every
  call, and the second analysis never resolved. It now keeps one proxy per worker.

## Consequences

- The fixture scan (a 612 × 792 pt page rendered at 2.5×) is recognized with 100% word recall
  against its source text. The whole E2E run, opening and recognizing it and then reopening it from
  the cache, takes about 33 s on Apple M3 Max, most of it loading the worker, core and data once.
- English only. Other languages need their traineddata bundled and a language choice.
- Handwriting, skewed or low-resolution scans will read poorly; the reader says when a page still
  has no readable text.
