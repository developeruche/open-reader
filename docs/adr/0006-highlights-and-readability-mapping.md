# 0006: CSS Custom Highlight API and Readability node mapping (spike 4)

Status: **works**, but the fingerprint fallback is required, not optional.

## Context

A runtime-registered content script (isolated world) cloned the document, recorded each text node's
child-index path, ran Readability 0.6.0 with `serializer: el => el`, resolved the article's text
nodes back to the live DOM, then painted `::highlight(or-sentence)` and `::highlight(or-word)`.

## Measurements

| Site                                             | Article text nodes | Resolved by path | Recovered by fingerprint | Time (paths / Readability / map) |
| ------------------------------------------------ | ------------------ | ---------------- | ------------------------ | -------------------------------- |
| en.wikipedia.org/wiki/Bitcoin                    | 3831               | 100%             | –                        | 78 / 46 / 16 ms                  |
| developer.mozilla.org (CSS Custom Highlight API) | 127                | **0%**           | 100%                     | 7 / 10 / 2 ms                    |
| paulgraham.com/greatwork.html                    | 415                | 100%             | –                        | 14 / 10 / 1 ms                   |

On MDN, Readability's first pass rejected the content and it retried after restoring the page from
`innerHTML`, which creates new text nodes, so no path survives. An ordered search for the next live
text node with the same whitespace-normalized text recovered every node.

Highlights rendered correctly from the isolated world on all three sites (screenshots in
`spikes/out/`), including MDN with its CSP. `Range.getClientRects()` returns usable rects.

## Decision

- Implement §7.1 as planned, with the ordered fingerprint search as the standard second pass
  (exact normalized text, monotonic cursor), then n-gram shingles for partial matches.
- Inject highlight styles with `chrome.scripting.insertCSS` (not a page `<style>`), so strict
  `style-src` CSPs can't block them.
- Path recording plus Readability costs ~125 ms on a very large page; run it once per extraction.
