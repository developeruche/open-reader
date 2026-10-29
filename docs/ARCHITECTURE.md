# Architecture

See PLAN.md §4 for the target design. This document is filled in as milestones land.

- `src/entrypoints/`: background, content script, side panel, reader, offscreen, options, onboarding.
- `src/core/`: pure TypeScript (no `chrome.*`), unit-tested.
- `src/platform/`: every `chrome.*` call, behind interfaces.

## UI (M2)

- `src/ui/styles.css` imports Tailwind v4, the self-hosted fonts and `tokens.css`; `@theme inline`
  maps the tokens to utilities (`bg-paper`, `text-ink`, `rounded-control`…).
- `src/ui/components/`: Radix-based primitives styled with the tokens.
- `src/ui/controls/`: transport pieces shared by the side panel and the reader page.
- `src/ui/reading/ReadingView.tsx`: the reader view (sentence tint, ink-inverted word, cursor).
- `src/ui/shells/`: one app per surface; `src/ui/mount.tsx` mounts them with providers.
- `src/ui/mock/`: mock document and player used until the real player lands (M4–M8).

## Text pipeline (M3)

`src/core/document`: the §5.1 model (`model.ts`), block building (`build.ts`), anchor lookups
(`anchors.ts`) and the `Navigator` over readable sentences (`positions.ts`).

`src/core/text`: `segment.ts` (Intl.Segmenter + repairs), `normalize.ts` (rules and pipeline),
`offsetMap.ts` (per-character maps), `lexicon.ts` (packs), `skip.ts` (reading rules, zod schema),
`pacing.ts` (structural pauses) and `segments.ts` (`SpokenSegment`s with maps and pauses).

```text
Block.text ──segment──▶ Sentence ──normalize──▶ spoken + OffsetMap ──split──▶ SpokenSegment[]
                                                     ▲ engine word timings use spoken offsets
```

## Audio and player (M4)

```text
Navigator ─▶ Player.segmentsFor() ─▶ PrefetchScheduler ─▶ engine.synthesize (worker via comlink)
                 ▲                         │   ▲ SynthesisCache (IndexedDB `audio`, LRU)
   playerMachine │ (XState: idle/preparing/buffering/playing/paused/seeking/retrying/error/ended)
                 │                         ▼
                 └──── PlaybackBackend ◀─ postProcess (trim −40 dBFS/30 ms, −20 dBFS RMS, pause)
                          │ started/ended/error
                          ▼
               SyncEvent stream (SEGMENT_STARTED, PAUSED, RESUMED, RATE_CHANGED, DRIFT…)
                          ▼
               ClockFollower in each visible context (rAF-driven cursor)
```

- `src/core/audio`: WAV, DSP, timing shift/estimation, `postProcess`.
- `src/core/player`: `machine.ts`, `player.ts`, `scheduler.ts`, `cache.ts`, `sync.ts`, `backend.ts`.
- `src/core/tts`: engine interfaces and the zod registry schema.
- `src/engines/test`: the deterministic TestEngine; `src/engines/rpc.ts`: worker RPC;
  `src/engines/playback/rendered.ts`: dual-`HTMLAudioElement` backend.
- `src/platform/audioCache.ts`: IndexedDB cache (`open-reader` db).

## Runtime (M5)

```text
UI (side panel, options) ──port `ui`──▶ background: Orchestrator ◀──port `content`── content script
                                          │  ▲                                   (extract, highlight)
                         port `engine-host`│  │ STATUS / SYNC / POSITION / NOTICE
                                          ▼  │
                                 offscreen.html: HostRuntime → Player → engine worker (comlink)
reader.html: HostRuntime (in-page) ──port `inpage-host`──▶ background (arbitration only)
```

- `src/runtime/`: `protocol.ts`, `orchestrator.ts`, `hostRuntime.ts`, `inpageHost.ts` (no chrome.*).
- `src/platform/`: `background.ts` (wiring), `offscreen.ts`, `ports.ts` (reconnecting ports),
  `session.ts` (storage.session), `library.ts` (IndexedDB library).
- `src/engines/factory.ts`: creates engines in workers.

## Web mode (M8)

`src/web/`: `extract.ts` (Readability + live-DOM mapping), `registry.ts`, `textBuilder.ts`,
`painter.ts` (CSS highlights), `cursor.ts`, `follow.ts`, `contrast.ts`, `highlightCss.ts`, and
`contentApp.ts`, which ties them to the sync stream, keyboard, click-to-read, the mini player and SPA
recovery. The side panel is `src/ui/shells/LiveSidePanel.tsx` with `src/ui/session/`.

## Document mode (M9)

`src/pdf/`: `textContent.ts` (PDF.js text items), `layout.ts` + `layout.worker.ts` (reading order,
headers/footers, columns, captions, references), `viewer.ts` (`PdfView` over PDF.js `PDFViewer`),
`textLayerMap.ts` (block offsets ↔ text layer ranges) and `readerController.ts`, which owns the
in-page host, the player, painting, follow-scroll and click-to-read. The UI is
`src/ui/shells/LiveReader.tsx` on `reader.html`. PDFs are stored by `src/platform/documents.ts`;
`src/platform/pdfIntercept.ts` manages the optional redirect rule. See ADR 0016.

## Reliability and diagnostics (M10)

`src/core/tts/fallback.ts` builds the engine fallback ladder that `sessionSettingsFrom` attaches to
each session; `HostRuntime` walks it when an engine cannot start or keeps failing and reports
`STATS` every second. The orchestrator keeps the diagnostics ring log (`src/core/diagnostics/log.ts`)
and the latest stats per host, served to `src/ui/shells/DiagnosticsSection.tsx` over the UI port.
`src/ui/shells/StorageSection.tsx` shows real storage use and the audio cache cap. See ADR 0017.
`src/engines/onnx/externalize.ts` loads WebGPU models with their weights as external data (ADR 0018).
