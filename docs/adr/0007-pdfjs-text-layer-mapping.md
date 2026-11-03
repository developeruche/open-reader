# 0007: PDF.js 6 text layer mapping (spike 5)

Status: **works**, with a mapping rule the plan did not mention.

## Context

A generated four-page, two-column PDF was rendered with `pdfjs-dist` 6.4.299 `PDFViewer`
(`EventBus`, `PDFLinkService`) with the worker, WASM decoders, standard fonts and cMaps loaded from
extension URLs. Target: the word "zebra" in the right column of page 3.

## Findings

- The text layer does **not** create one span per `textContent` item. `TextLayer` creates a div for
  every item with `str !== undefined` but **appends it only when `str !== ''`**; empty items with
  `hasEOL` emit only a `<br>`. Marked-content wrappers are also `span.markedContent`.
  Page 3 had 84 items and 82 spans, so naive index mapping highlighted the wrong text.
- `TextLayer.textDivs` is private behind `TextLayerBuilder` in 6.x (`#textLayer`).
- Correct mapping: `domIndex = count of items before i with str !== ''`, over
  `.textLayer span:not(.markedContent)`. With that, `(page 3, item 52, offset 10)` → Range text
  "zebra" at x = 0.60 of the page width (right column), painted with `::highlight(or-word)`.
- First page rendered 55 ms after `getDocument` (small file).

## Decision

Implement §8.4 with this rule, use the same `getTextContent({ includeMarkedContent: true,
disableNormalization: true })` options as the text layer for layout analysis, and cover it with a
unit test on the mapping function plus the E2E on the two-column fixture.

## Note: page box sizing (post-1.0)

The app's Tailwind base sets `box-sizing: border-box` on every element. PDF.js sizes its pages
for `content-box` (each `.page` has a 9 px border), so the canvas shrank by 18 px while the text
layer kept the full page size, and word highlights drifted right and down across the page.
`src/pdf/viewer.css` restores `content-box` for `.pdfViewer .page`, and an E2E test checks that the
text layer and the canvas have the same box.
