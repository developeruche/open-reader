# 0015: Web mode (M8)

## Decisions

- **Extraction** (`src/web/extract.ts`): Readability on a clone with `serializer: el => el`; clone
  text nodes map to live ones by child-index path, then by an ordered whitespace-normalized text
  fingerprint (ADR 0006). Pages with less than 200 characters of article text are read in
  "visible text" mode (nav, header, footer, aside, hidden and invisible elements skipped). Block
  types come from the article structure (`p, li, h1–h6, blockquote, pre, figcaption, tr, dt, dd`);
  table cells are joined with ", "; inline `code/kbd/samp` become `marks`; a heading named
  References/Bibliography/Works cited/Notes starts a `reference` region.
- **Whitespace** is collapsed while building block text (`BlockTextBuilder`); each run keeps the
  exact node and offset, and a collapsed space spanning nodes has no anchor, so highlights always
  land on real characters.
- **Reading rules are applied by the background** when a session starts (`applySkipRules`), so the
  page, the side panel and the player number sentences identically. The page therefore sends text
  points (`{ blockId, offset }`) for click-to-read and "from here"; the background resolves the
  sentence with the same `Navigator` options as the player.
- **Painting** uses the CSS Custom Highlight API with styles injected by `scripting.insertCSS`
  (light `or-sentence/or-word`, dark `or-sentence-dark/or-word-dark`). The variant is chosen from
  the luminance of the first opaque background under the sentence (< 0.25 → dark). The cursor is a
  closed-shadow overlay moved by `translate/scaleX`. Each tab runs its own `ClockFollower` driven by
  `requestAnimationFrame`.
- **Follow-scroll** keeps the sentence in 25–65% of the viewport (target 35%); wheel, touch, scroll
  keys and non-programmatic scroll events suspend it for 5 s.
- **"Read page from here"**: the content script is injected on demand, so it cannot know where the
  user right-clicked before injection. It uses the recorded right-click point when the script is
  already present, otherwise the first block visible in the viewport.
- **SPA re-renders**: a MutationObserver (debounced 250 ms) re-extracts when anchored nodes are gone;
  if the block texts are unchanged the anchors are swapped in place, otherwise page highlights stop
  and the side panel keeps following (a notice explains this).
- **Mini player and "Play from here"** render in closed shadow roots with self-contained CSS and the
  system UI font (registering our fonts would add FontFaces to the page). The content script bundles
  React for the mini player (content script ~580 kB, injected only on demand).
- **Side panel** (`LiveSidePanel`): empty state with "Read this page"; transport, speed (local value
  while adjusting, so round-trip echoes cannot pull the slider back), voice (voices of the current
  engine), progress with time left (≈ 0.065 s per character), reader view with muted skipped blocks
  and click-to-seek, outline, quick settings, engine status. It accepts `?tabId=` for tests.
- **Tests read highlights** through `data-or-*` attributes on `<html>` that only `--mode test`
  builds write.

## Consequences

E2E covers every web fixture: highlights advance in reading order, follow-scroll, user-scroll
suspension, SPA re-render recovery, dark-page contrast, Alt+click, in-page keys, the mini player,
the side panel and resume per URL.
