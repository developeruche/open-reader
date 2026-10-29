# 0012: Extension runtime, hosts and messaging (M5)

## Context

§4.2 splits the extension into a background orchestrator, an offscreen engine host for web mode,
an in-page engine host for document mode, UI surfaces and content scripts. M5 builds that wiring.

## Decisions

- **Own typed messaging instead of `@webext-core/messaging`.** That package needs `@types/chrome`
  as a peer, which conflicts with WXT's bundled `@wxt-dev/browser` types, and almost all traffic is
  on long-lived ports anyway. `src/runtime/protocol.ts` defines every message as a TypeScript union;
  commands from UI ports are validated with zod (`parseUiCommand`) because any extension page or
  content script can post them. Ports: `engine-host`, `inpage-host`, `ui`, `content`.
- **Pure orchestrator.** `src/runtime/orchestrator.ts` has no `chrome.*`; `src/platform/background.ts`
  wires it to ports, commands, menus and the side panel. It is unit-tested with fakes.
- **Shared host runtime.** `HostRuntime` owns one `Player`; the offscreen document and the reader
  page differ only in transport. Loads are serialized by token so a superseded LOAD never creates a
  player (found as an E2E flake: a stale idle player reported `idle` for the live session).
- **Queue, then create.** The orchestrator queues LOAD before calling `offscreen.ensure()`; a new
  host can say HELLO before `createDocument` resolves, and must find the LOAD already queued.
- **State for restarts.** `chrome.storage.session` holds the live `SessionInfo` and the current
  `ReadingDocument` (older documents are removed; the area is limited to 10 MB). Positions go to the
  IndexedDB `library` store (DB version 2), keyed by document id, for resume across browser restarts.
- **Recovery** (§9.2): a host port disconnect plus `getContexts` marks `hostLost`; the next PLAY
  recreates the document and reloads the session at the saved sentence with autoplay. Cached audio
  makes it instant. Ports reconnect with exponential backoff (100 ms → 5 s); an offscreen host that
  kept playing through a worker restart reconnects and the new worker resyncs from its HELLO status
  instead of reloading.
- **Arbitration** happens on STATUS: when a host starts playing, the background pauses any other
  active host. Overlap is bounded by message latency; the E2E test requires < 250 ms.
- **Offscreen reasons** `AUDIO_PLAYBACK` + `WORKERS` (ADR 0005), so the 35-second-pause test
  resumes without a rebuild; a separate test forces closure to exercise recovery.
- **Content extraction is minimal in M5** (headings, paragraphs, list items, quotes, code; nav,
  header, footer and aside skipped). M8 replaces it with Readability and live-DOM anchors.
- **Test-only debug channel**: in `--mode test` builds the worker exposes `__openReader` (session,
  debug log, commands, offscreen control). Production builds don't include it.
- **Service worker restart in E2E**: `Target.closeTarget` on the worker target via CDP; Playwright's
  `ServiceWorker.stopAllWorkers` from a page session does not reach extension workers.

## Consequences

Measured in E2E (TestEngine): resume after a forced offscreen close in under 3 s at the same
sentence; a 35 s pause resumes at the same sentence; the session survives a worker restart; at most
one segment audible in the offscreen host; the two hosts are never both playing for more than 250 ms.
