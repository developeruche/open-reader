# Open Reader: Build Plan for Claude Code

> **How to use this file.** Save it as `PLAN.md` in an empty folder, open Claude Code there, and say: *"Read PLAN.md completely, then execute it milestone by milestone."* Everything below is written as instructions to the coding agent.

---

## 0. Your role and the rules of the job

You are the lead engineer building **Open Reader**, a Chrome extension that reads web pages and PDFs aloud with natural, on-device voices, while a highlight and a cursor follow the voice word by word.

The owner is an experienced systems engineer who wants a tool reliable enough to **replace Speechify**, which has been unreliable for them. Open Reader is for **research and personal use only**. It will not be monetized or published to the Chrome Web Store; it is installed as an unpacked extension.

**Working rules**

1. **Read the whole plan before writing code.** Then execute the milestones in §13 in order (M0 to M14). Do not start a milestone until the previous one meets the Definition of Done in §12.
2. **Track progress.** Keep `docs/PROGRESS.md` current: the milestone checklist, decisions made, and known issues. Record every significant technical decision as a short ADR in `docs/adr/NNNN-title.md`, giving context, decision, alternatives and consequences.
3. **Commits.** Make exactly one commit at the end of every milestone, after all checks pass. The message is a **single line**: no body, no trailers, no co-author lines. Use the format `M<n>: <imperative summary, ≤ 72 chars>`, for example `M4: audio pipeline, player state machine and synthesis cache`. If your environment adds commit trailers automatically, disable that for this repo first. Never commit model weights, API keys, user documents or build output.
4. **Keep the code honest.** Prefer small, pure, strongly typed modules: no `any`, and no `@ts-ignore` without a comment explaining why. All `chrome.*` calls live in `src/platform/**` behind interfaces, so core logic runs in plain unit tests.
5. **Don't quietly weaken requirements.** When reality contradicts this plan (an API behaves differently, a library is broken or abandoned), write an ADR, pick the closest alternative that keeps the requirement, and continue.
6. **Ask the owner only when you need their ears or their machine:**
   - choosing the default voice after the listening test (M7);
   - manual checks in their own Chrome profile (loading the unpacked build, file-URL access);
   - anything that would make the extension depend on the network.

   Everything else has a default in this plan.
7. **Dependencies.** Use **pnpm** and pin exact dependency versions. Check every third-party package's license and list it in `docs/THIRD_PARTY.md`, with model licenses in `docs/MODELS.md`.
8. **Be offline-first.** After the one-time model download, the extension must work with the network disabled. Manifest V3 forbids remotely hosted code, so every JS and WASM file is bundled. Only model weights, which are data, may be downloaded.

---

## 1. Product summary

**Open Reader** is offline-first read-aloud for Chrome, with two modes:

| Mode | Surface | What it does |
|---|---|---|
| **Web mode** | Chrome side panel, plus highlights on the page | Reads the main content of the current page (blog posts, docs, articles). Highlights the current sentence and word on the page, auto-scrolls, and supports click-to-read-from-here and reading a selection. |
| **Document mode** (full-page app) | Extension page `reader.html` | Opens a PDF, renders it, and reads it in the correct reading order. A cursor follows the voice word by word across pages. |

**Product principles, in priority order**

1. **Reliable.** Playback never stops silently. The reading position is never lost. Every failure shows a visible way to recover.
2. **Offline by default.** After the model download, everything is local: no telemetry, and no document text leaves the device unless the owner turns on an online voice.
3. **Natural audio.** A strong voice model, careful text normalization, and pacing driven by structure (pauses between sentences, list items, paragraphs and headings).
4. **Fast.** With the voice warm, first audio plays under a second after pressing Play.
5. **Quiet design.** Black and off-white, editorial typography, keyboard-first, accessible (WCAG 2.2 AA).

**Non-goals for v1.** Firefox and Safari, mobile, accounts and sync, Chrome Web Store publishing, EPUB and DOCX, and languages other than English. Design the document model and engine registry so these can be added later without rewrites.

### 1.1 Feature scope

**MUST (v1)**

- **Web mode.**
  - Read the page's main content, or the visible text if extraction fails.
  - Sentence and word highlighting on the live page, with a reading cursor and auto-scroll that pauses while the user scrolls.
  - Click-to-read-from-here and "Read selection" from the context menu.
  - A side panel with transport controls, voice, speed, outline and a synced reader view.
- **Document mode.**
  - Open a PDF from a file, by drag and drop, from a URL, or from a link's context menu.
  - Render with PDF.js and work out reading order (columns, headers and footers, dehyphenation).
  - Word cursor, sentence highlight, follow-scroll across pages, click any word to read from there, zoom, page navigation and outline.
- **Engines.**
  - Swappable models through a registry.
  - Default on-device model (§6), a fast on-device fallback, and system voices as a zero-download fallback.
- **Playback.**
  - Speed from 0.5× to 4×, with pitch preserved.
  - Skip by sentence or paragraph, pacing presets, a sleep timer, and resume where you left off (per URL and per PDF).
- **Text.**
  - Normalization (acronyms, numbers, symbols, URLs, code) that maps every spoken word back to its source.
  - Pronunciation dictionary and skip rules (code blocks, tables, citations, URLs, references, headers and footers).
- **Reliability.**
  - A state-machine player, a watchdog, recovery when the engine host restarts, an audio cache, and diagnostics.
- **Keyboard and settings.**
  - Keyboard shortcuts.
  - Options page and first-run onboarding (voice preview, model download, benchmark).

**SHOULD (v1)**

- Floating mini player on the page (in a shadow DOM).
- Library of recent documents with progress.
- Audiobook export (MP3 with chapter markers).
- Domain pronunciation packs (programming, Bitcoin/Ethereum).

**COULD (v1, if time allows)**

- Online voices (opt-in, M12).
- OCR for scanned PDFs (M13).
- Optional interception of `.pdf` links.

---

## 2. UI/UX skills: install these first (researched October 2026)

**Research summary.** As of late October 2026, the most-installed design skill for Claude Code is **Anthropic's official `frontend-design`** (about 1M installs on skill registries). Next come Vercel's `vercel-react-best-practices` and `web-design-guidelines`, and the `taste-skill` collection.

Use a **small, non-conflicting set**:

| Skill | Source | Use it for |
|---|---|---|
| `frontend-design` | `anthropics/skills` (official) | Any time you create or restyle a UI surface. Pushes toward distinctive, production-grade interfaces instead of generic AI templates. |
| `minimalist-ui` | `leonxlnx/taste-skill` | Aesthetic direction: warm monochrome, off-black on bone backgrounds, serif headings, flat grids, restrained motion. This matches the black and off-white brief. |
| `web-design-guidelines` | `vercel-labs/agent-skills` | Audit pass at the end of every UI milestone (consistency, UX, accessibility). |
| `accessibility` | `addyosmani/web-quality-skills` | WCAG 2.2 audit and fixes. |

**Install them at project scope in M0:**

```bash
npx skills add https://github.com/anthropics/skills --skill frontend-design -a claude-code
npx skills add https://github.com/leonxlnx/taste-skill --skill minimalist-ui -a claude-code
npx skills add vercel-labs/agent-skills --skill web-design-guidelines -a claude-code
npx skills add addyosmani/web-quality-skills --skill accessibility -a claude-code
```

**Rules for skills**

- **Read before installing.** Skills are instructions and can bundle scripts. Read each `SKILL.md` and any scripts on GitHub first, and stop if one does anything beyond design guidance.
- **The brand rules in §3 override every skill.** In particular, ignore `minimalist-ui`'s pastel accents and its `#EAEAEA` border rule, and use our tokens instead.
- **Don't add more design skills** without an ADR.
- **Workflow on every UI task:**
  1. Load `frontend-design` and `minimalist-ui`.
  2. Build.
  3. Run `web-design-guidelines` and `accessibility` as a review pass.
  4. Fix the findings.
  5. Commit at the end of the milestone.

---

## 3. Design system: black and off-white

### 3.1 Tokens

Implement the tokens as CSS custom properties, exposed through Tailwind CSS v4's `@theme`. Light and dark are both first-class. Follow the system setting by default, with a manual override.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--paper` | `#F6F4EF` | `#0B0B0B` | App background |
| `--paper-2` | `#EFECE5` | `#151514` | Raised surfaces, panels |
| `--line` | `#E1DDD4` | `#2A2926` | Borders, dividers (1px) |
| `--ink` | `#0B0B0B` | `#F6F4EF` | Primary text, primary buttons |
| `--ink-2` | `#2B2A28` | `#D9D5CC` | Secondary text |
| `--muted` | `#6B675F` | `#A39E94` | Captions, metadata (≥ 4.5:1 on paper) |
| `--word-bg` / `--word-fg` | `#0B0B0B` / `#F6F4EF` | `#F6F4EF` / `#0B0B0B` | Current word ("ink" inversion) |
| `--sentence-bg` | `rgba(11,11,11,0.07)` | `rgba(246,244,239,0.12)` | Current sentence tint |
| `--focus` | 2px `--ink` ring, 2px offset in `--paper` | same, inverted | Focus-visible |

- **No other hues anywhere.** Only black, off-white and neutral grays derived from them. Show status with icons and text, never colour alone. Errors use ink, a bold label and an icon.
- **No gradients, glassmorphism or heavy shadows.** At most one soft shadow for floating elements: `0 1px 2px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06)`.
- **Radii:** 6px for controls, 12px for cards and the floating player, fully round for the main play button.
- **Spacing scale:** 4, 8, 12, 16, 24, 32, 48.
- **Motion:** 120–180 ms ease-out. Honour `prefers-reduced-motion`: the cursor jumps instead of gliding, and there are no smooth scrolls.

### 3.2 Typography

Self-host every font as WOFF2, for example from Fontsource packages. Never load fonts from a CDN at runtime.

- **UI:** Geist (variable). **Mono:** Geist Mono.
- **Headings and the reader view:** Newsreader (variable serif), with tight tracking on headings.
- **Banned:** Inter, Roboto and Open Sans (per the `minimalist-ui` skill).
- **Reader view:** 18–20px body text, 1.6 line height, 62–70 characters per line.

### 3.3 Highlight and cursor language

The same visual language is used everywhere: the page, the reader view and the PDF.

- **Current sentence:** a `--sentence-bg` tint.
- **Current word:** ink inversion (`--word-bg`/`--word-fg`).
- **Reading cursor:** a 2px ink bar under the current word, gliding (120 ms) from word to word. It is drawn as an overlay element, because CSS highlight pseudo-elements only support a few properties.
- **Contrast on any page:** on web pages, detect the background luminance under the content and pick light or dark highlight variants so contrast always holds.

### 3.4 Surfaces

Each surface needs light and dark variants and full keyboard support.

1. **Side panel (Web mode).** Chrome lets users resize it; design for 320–600px.
   - **Header:** document title (serif), site name, overflow menu.
   - **Hero transport:**
     - a 56px round ink Play/Pause button;
     - previous and next sentence;
     - a speed chip (`1.0×`) opening a slider with presets;
     - a voice chip opening the voice picker.
   - **Progress:** a progress line (sentence n of N), with time remaining in the current voice.
   - **Tabs:**
     - **Reader** (the extracted text with synced highlight; click a sentence to jump there);
     - **Outline** (headings);
     - **Settings** (quick settings).
   - **Footer:** engine status, for example "On-device · Kokoro · WebGPU" with a small dot, or "Offline ready".
2. **Reader page (Document mode).**
   - **Top bar:** file name, page `x / y`, zoom, search, settings.
   - **Left drawer:** thumbnails and outline, collapsible.
   - **Centre:** the PDF on `--paper-2`, with pages on white-ish `--paper`.
   - **Floating transport:** a black pill at the bottom, with play/pause, previous/next sentence, a sentence scrubber, speed, voice and time left.
   - **Follow toggle:** "Follow" on/off.
   - **Right drawer:** reading rules (skip headers and footers, references, captions).
3. **Mini player (on the page, optional).** A 44px black pill in a corner, with play/pause, speed and a "jump to reading position" control. It lives in a closed shadow root and can be dragged.
4. **Options page.** Sidebar navigation with these sections:
   - Voices & models
   - Playback
   - Reading rules
   - Pronunciations
   - Online voices
   - Shortcuts
   - Storage
   - Diagnostics
   - About & licenses
5. **Onboarding (first run).**
   1. Welcome.
   2. Pick a voice (play 10-second samples).
   3. Download the model, showing size, license, progress and verification.
   4. Run a quick benchmark that picks WebGPU or WASM.
   5. Learn the shortcuts.
   6. Done.

**Components.** Build on Radix UI primitives styled with our tokens. shadcn/ui-generated components are fine only if they integrate cleanly with WXT and are restyled to our tokens; no stock shadcn look. Use Lucide icons at 1.5px stroke.

You need: Button, IconButton, Toggle, Slider, Select/Combobox, Tabs, Dialog, Drawer, Tooltip, Toast, Progress, Skeleton, Kbd, Badge and EmptyState.

---

## 4. Architecture

### 4.1 Stack

Use the latest stable versions at the start of work. These references were checked in October 2026.

| Concern | Choice (reference version) | Notes |
|---|---|---|
| Extension framework | **WXT** (0.21.x) | MV3, HMR, typed entrypoints, Vitest plugin and `fakeBrowser` for unit tests |
| UI | **React 19.x** + **Tailwind CSS 4.x** + Radix UI primitives + Lucide | Fonts self-hosted |
| Language | TypeScript (strict) | Use the newest TypeScript that WXT, Vitest and typescript-eslint support together |
| State | Zustand (UI state), **XState 5.x** (player) | Pure core logic |
| Messaging | `@webext-core/messaging` (typed) + long-lived `runtime.Port`s | |
| Validation | **zod 4.x** | Settings, registry, messages |
| Storage | `chrome.storage` (settings/session), IndexedDB via **idb 8.x** (library, cache, logs), OPFS (model files, PDFs) | |
| Inference | **onnxruntime-web 1.31.x**, **@huggingface/transformers 4.x** where useful | WebGPU first, WASM fallback, all assets bundled |
| TTS | Kokoro-82M (timestamped ONNX), Piper (VITS ONNX), `chrome.tts`, optional online providers | See §6 |
| PDF | **pdfjs-dist 6.x** (`PDFViewer`, `EventBus`, `PDFLinkService`, `PDFFindController`, text layer) | Worker and WASM decoders bundled |
| Web extraction | **@mozilla/readability 0.6.x** (primary), **defuddle** (optional comparison) | Node-identity mapping trick in §7.1 |
| Audio export | **wasm-media-encoders** (MIT) for MP3, plus our own ID3v2.3 CHAP/CTOC writer | |
| Worker RPC | **comlink 4.x** | |
| Tests | **Vitest 5.x** (unit + browser mode), **Playwright 1.6x** (E2E with the extension), **@axe-core/playwright**, **msw** (online-provider contract tests), **pdf-lib** (fixture generation) | |
| Lint and format | ESLint (typescript-eslint, react-hooks, jsx-a11y), Prettier | |

### 4.2 Extension contexts and responsibilities

```text
┌────────────────────────── Chrome ───────────────────────────────────────────┐
│  Service worker (background.ts)                                               │
│   - Session orchestrator: one active reading session at a time                │
│   - Routes UI ⇄ engine-host ⇄ content-script messages                         │
│   - Creates/recreates the offscreen document, handles commands, menus         │
│   - Persists live session state (storage.session)                             │
│                                                                               │
│  Content script (per tab, injected on demand)                                 │
│   - Extracts the reading document from the live DOM (+ source anchors)        │
│   - Paints sentence/word highlights (CSS Custom Highlight API) + cursor       │
│   - Follow-scroll, click-to-read, selection reading, mini player              │
│                                                                               │
│  Side panel (sidepanel.html)        Options (options.html)                    │
│   - Web-mode UI, reader view         - Settings, models, diagnostics          │
│                                                                               │
│  Offscreen document (offscreen.html)  = ENGINE HOST for Web mode              │
│   - TTS engine workers (Kokoro WebGPU / Piper WASM)                           │
│   - Audio post-processing, playback (HTMLAudioElement), timing clock          │
│                                                                               │
│  Reader page (reader.html)  = Document mode app + its own in-page ENGINE HOST │
│   - PDF.js viewer, layout-analysis worker, cursor overlay                     │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Facts that shape this design (verified October 2026):**

- **Offscreen documents.**
  - Chrome 109+ and MV3 only, with one offscreen document per extension at a time.
  - The only extension API available inside one is `runtime`.
  - The `AUDIO_PLAYBACK` reason closes the document after 30 seconds without audio playing.

  So the offscreen host must survive being closed while paused (§9.2). It can't call `chrome.tabs`, so the background relays messages to tabs. Use `chrome.runtime.getContexts` to check whether the document already exists.
- **Side panel.**
  - Chrome 114+.
  - `sidePanel.open()` is Chrome 116+ and only works in response to a user gesture (action click, shortcut, context menu, or a user gesture on an extension page or content script).
  - Use `setPanelBehavior({ openPanelOnActionClick: true })`.
  - `sidePanel.close()`, `onOpened` and `onClosed` only exist in Chrome 141–142+, so feature-detect them.
- **Animation timing.** Hidden documents (offscreen) throttle `requestAnimationFrame`, so the engine host uses timers and media time. Visual animation happens in visible contexts (content script, side panel, reader page).

**Engine hosts.** One `EngineHost` interface has two implementations:

- `OffscreenHost` for Web mode;
- `InPageHost` for Document mode, so the reader tab owns its engine and never hits the offscreen lifetime limit.

The background arbitrates so only one session is ever audible: starting a session in one host pauses the other.

### 4.3 Timing sync

Don't stream every word event through the background. When a segment starts, the host sends one message:

`SEGMENT_STARTED { sessionId, segmentId, words: [{i, start, end}], mediaStartEpochMs, rate }`

Each visible context (content script, side panel, reader page) then runs its own `requestAnimationFrame` clock. It computes the current word as `(Date.now() - mediaStartEpochMs) * rate / 1000`, which gives smooth 60 fps cursor motion at low message volume.

These events re-anchor the clock: `PAUSED {mediaTime}`, `RESUMED {mediaStartEpochMs}`, `RATE_CHANGED {rate, mediaTime, atEpochMs}`, `SEEKED`, `SEGMENT_ENDED`. The host also sends a drift correction every 2 seconds.

Test that drift stays within 50 ms over 10 minutes.

### 4.4 Storage layout

| Store | Contents |
|---|---|
| `chrome.storage.local` | Settings (zod-validated, versioned migrations), installed-model index, online API keys (never synced) |
| `chrome.storage.session` | Live session: doc ID, segment, word, rate, voice, host state (for service-worker or host restarts) |
| IndexedDB `open-reader` | `library` (documents, progress, last position), `audio` (synthesis cache, LRU), `logs` (ring buffer), `lexicon` (user pronunciations) |
| OPFS `/models/<modelId>/<version>/…` | Model weights and voice files (verified by SHA-256) |
| OPFS `/documents/<sha256>.pdf` | Stored PDFs for offline reopening |

Request the `unlimitedStorage` permission. Call `navigator.storage.persist()` and show usage and quotas on the Storage settings page.

### 4.5 Manifest (via `wxt.config.ts`)

- **Name and description:** `name: "Open Reader"`, `description: "Offline, reliable read-aloud for web pages and PDFs."`. Version 0.x until M14, then 1.0.0.
- **`permissions`:** `sidePanel`, `offscreen`, `storage`, `unlimitedStorage`, `scripting`, `activeTab`, `contextMenus`, `tts`, `downloads`, `declarativeNetRequestWithHostAccess` (only used if PDF interception is enabled).
- **`host_permissions`:** `["<all_urls>"]`. This is personal use, so broad access is acceptable. Document it in `docs/PRIVACY.md`.
- **`side_panel.default_path`:** `sidepanel.html`. Declare `action` with a title.
- **`content_security_policy.extension_pages`:** `"script-src 'self' 'wasm-unsafe-eval'; object-src 'self';"`. WebAssembly needs `wasm-unsafe-eval`, and nothing is ever loaded remotely.
- **`minimum_chrome_version`:** `"116"`.
- **`commands`:** Chrome allows at most four suggested keys.
  - `_execute_action` (Alt+Shift+O)
  - `toggle-play` (Alt+Shift+P)
  - `next-sentence` (Alt+Shift+Period)
  - `prev-sentence` (Alt+Shift+Comma)

  Other shortcuts are in-page keyboard handlers, listed on the Shortcuts settings page.
- **`web_accessible_resources`:** only what content scripts need (fonts, highlight CSS), plus `reader.html` if PDF interception redirects to it.
- **Cross-origin isolation:** don't enable COOP/COEP at first (it can break cross-origin fetches). Revisit in M10 only if measurements show multi-threaded WASM is needed, and record the decision in an ADR.

### 4.6 Repository layout

```text
open-reader/
  wxt.config.ts  package.json  tsconfig.json  vitest.config.ts  playwright.config.ts
  PLAN.md  README.md
  src/
    entrypoints/
      background.ts
      content/index.ts                  # extraction, highlights, cursor, scroll, mini player
      sidepanel/{index.html,main.tsx}
      reader/{index.html,main.tsx}       # Document mode (unlisted page)
      offscreen/{index.html,main.ts}     # Engine host (unlisted page)
      options/{index.html,main.tsx}
      onboarding/{index.html,main.tsx}
    core/                                # pure TS, zero chrome.* imports
      document/   (model, anchors, offset maps, positions)
      text/       (segmentation, normalization, lexicon, skip rules, pacing)
      audio/      (wav, trim, loudness, timing estimation, resampling)
      player/     (xstate machine, scheduler, prefetch, cache interface, clock)
      tts/        (engine + backend interfaces, registry schema)
    engines/      kokoro/ piper/ system/ online/ test/   (each: adapter + worker)
    web/          (extraction, dom mapping, highlight painter, scroll, mini player)
    pdf/          (loader, viewer, layout worker, mapping, cursor overlay, ocr/)
    platform/     (messaging, storage, offscreen manager, permissions, logger, downloads)
    ui/           (tokens.css, components/, icons, fonts)
  models/registry.json                    # model catalogue (no weights)
  scripts/      (fetch-models.ts, make-fixtures.ts, bench.ts, synth-corpus.ts)
  tests/        (unit mirrors src/, browser/, e2e/, fixtures/web, fixtures/pdf, fixtures/corpus)
  quality/      (Python ASR harness: pyproject.toml, asr_qa.py)
  docs/         (ARCHITECTURE.md, MODELS.md, TESTING.md, PRIVACY.md, THIRD_PARTY.md, PROGRESS.md, adr/)
  .github/workflows/ci.yml
```

---

## 5. Core model and pipelines

### 5.1 Reading document model

Every source (a web page, a PDF, or later EPUB) becomes the same model, which keeps a source map back to the original.

```ts
type DocKind = 'web' | 'pdf';

interface ReadingDocument {
  id: string;                 // sha256 of the canonical URL or the PDF bytes
  kind: DocKind;
  title: string;
  lang: string;               // BCP-47, 'en' for v1
  blocks: Block[];
}

type BlockType = 'heading' | 'paragraph' | 'listItem' | 'quote' | 'caption'
               | 'code' | 'tableRow' | 'footnote' | 'reference';

interface Block {
  id: string;
  type: BlockType;
  level?: number;             // heading level, list depth
  text: string;               // display text (NFC), as the user sees it
  anchors: AnchorRun[];       // text offset range -> source position
  sentences: Sentence[];
  skip?: SkipReason;          // set by reading rules; skipped blocks stay visible in UI
}

interface Sentence { id: string; blockId: string; start: number; end: number; words: Word[] }
interface Word { start: number; end: number }          // offsets into block.text

type Anchor =
  | { kind: 'dom'; nodeRef: number; offset: number }   // nodeRef -> live Text node via registry
  | { kind: 'pdf'; page: number; item: number; offset: number };

interface AnchorRun { start: number; end: number; anchor: Anchor }  // contiguous mapping

interface ReadingPosition { docId: string; sentenceId: string; word: number; updatedAt: number }
```

### 5.2 Text pipeline

1. **Segmentation.**
   - Use `Intl.Segmenter('en', { granularity: 'sentence' })`.
   - Repair its known failure cases with a guard list: abbreviations (e.g., i.e., Dr., Fig., et al.), decimals, version numbers (`v2.0.0`), initials, URLs, ellipses and quotes.
   - Word boundaries come from `Intl.Segmenter` with `granularity: 'word'`, using `isWordLike`.
2. **Skip rules** (per-document overrides, with the defaults shown):

   | Content | Default | Notes |
   |---|---|---|
   | Code blocks | Skip | Announce "Code block skipped" once per block (setting) |
   | Inline code | Read | Split identifiers: `camelCase` → "camel case", `snake_case` → "snake case" |
   | Tables | Skip | Or read row by row as "Row 2: Name, Alice; Role, Admin" |
   | Image alt text | Skip | |
   | Figure captions | Read | |
   | Bracketed citations `[12]` | Skip | |
   | Footnote markers | Skip | |
   | Bare URLs | Skip | Or say "link to example dot com" |
   | References/Bibliography section | Skip | |
   | PDF headers and footers, page numbers | Skip | |

3. **Normalization (display text → spoken text).** Every rule is a pure function returning `{ spoken, map }`, where `map` is a piecewise offset map from spoken offsets back to display offsets. The engine's word timings are in spoken-text offsets, and the highlight must land on the original words. Rules, in order:
   1. Unicode NFKC for ligatures (`ﬁ` → `fi`), keeping the map.
   2. Symbols: `‖` → "followed by", `≥` → "at least", `≤` → "at most", `→` → "to", `×` → "times", `&` → "and", `%` → "percent", `~` → "about".
   3. Abbreviations: "e.g." → "for example", "i.e." → "that is", "etc." → "and so on", "vs." → "versus".
   4. Acronyms: tokens of 2–6 capitals or capitals plus digits that aren't in the speakable list (NASA, NATO, JSON, …) are spelled out. "PSBT" → "P S B T" and "PSBTs" → "P S B T's".

      A raw "PSBT" through Piper was heard as "Apedus BT" in the owner's audiobook test, so this rule matters.
   5. Numbers and units: keep digits (the models read them well). Handle hex (`0x1a` → "hex one A"), versions (`v32.0` → "version 32.0"), ranges, ordinals, and units like `vB` → "virtual bytes" and `sat/vB` → "sats per virtual byte".
   6. Lexicon: user entries, then domain packs, then built-ins. Entries can target a specific engine, because the same spelling isn't right for every voice. For example, Piper needs "nonce" spelled "nonss" while Kokoro may not.
4. **Lexicon.**
   - Entry: `{ match: string | RegExp, say: string, engines?: string[], caseSensitive?: boolean }`.
   - **Editor:** a table with a "test" button that synthesizes the word with the current voice, plus JSON import and export.
   - **Built-in packs:**
     - *Programming:* npm → "N P M", SQL, CLI, API, URL, JSON, YAML → "yammel", GitHub, etc.
     - *Bitcoin/Ethereum:* UTXO → "U T X O", txid → "T X I D", BIP → "bip", sighash → "sig hash", MuSig → "mew sig", xpub → "x pub", PSBT, EVM, ERC, etc.
5. **Pacing plan.**
   - **Natural preset**, the values that made the owner's PSBT audiobook sound natural:

     | Point in the text | Pause |
     |---|---|
     | Between sentences | 0.22 s |
     | After a list item | 0.45 s |
     | After a paragraph | 0.70 s |
     | Before a heading | 1.30 s |
     | After a heading | 0.80 s |

   - **Other presets:** Brisk (×0.6) and Relaxed (×1.4).
   - Pauses are added after trimming each synthesized segment's own leading and trailing silence.
6. **Segments.** A `SpokenSegment` holds one sentence, split at clause boundaries if it exceeds the engine's limit (Kokoro: ≤ 510 phoneme tokens). It also carries the source map and its pauses.
   - **Fast start:** if the first segment of a session is longer than 120 characters, split it at the first clause boundary so audio starts sooner.

### 5.3 Engine abstraction

```ts
interface ModelRef { modelId: string; version: string; voiceId: string }

interface SynthesisRequest { text: string; voiceId: string; speed: number; lang: string }

interface WordTiming { charStart: number; charEnd: number; start: number; end: number } // seconds, spoken-text offsets

interface SynthesisResult {
  pcm: Float32Array; sampleRate: number;
  words?: WordTiming[];                 // native timings if the engine provides them
}

interface RenderEngine {                // produces audio we play ourselves
  readonly kind: 'render';
  readonly id: string;                  // 'kokoro' | 'piper' | 'elevenlabs' | 'openai' | 'test'
  readonly caps: { wordTimings: 'native' | 'estimated'; maxChars: number; requiresNetwork: boolean;
                   backends: ('webgpu' | 'wasm' | 'remote')[] };
  init(model: ModelManifest, opts: { backend: 'auto' | 'webgpu' | 'wasm'; onProgress?: (p: Progress) => void;
       signal?: AbortSignal }): Promise<{ backend: string }>;
  voices(): Promise<VoiceInfo[]>;
  synthesize(req: SynthesisRequest, signal?: AbortSignal): Promise<SynthesisResult>;
  dispose(): Promise<void>;
}

interface LiveEngine {                  // speaks by itself (chrome.tts)
  readonly kind: 'live';
  readonly id: 'system';
  speak(req: SynthesisRequest, on: { word(charIndex: number): void; end(): void; error(e: Error): void }): void;
  pause(): void; resume(): void; stop(): void;
  voices(): Promise<VoiceInfo[]>;
}
```

- **Where engines run.** Render engines run inside a dedicated Web Worker (comlink) in the engine host, so the UI never janks.
- **Playback backends.** The player talks to a `PlaybackBackend`:
  - `RenderedBackend` plays our PCM;
  - `LiveBackend` wraps `chrome.tts`.

  This lets the player state machine treat both the same way.

### 5.4 Audio pipeline (render engines)

1. **Post-processing**, all pure and unit-tested:
   1. Trim leading and trailing silence. Use a threshold of about −40 dBFS with a 30 ms margin, the same as the audiobook pipeline.
   2. Normalize loudness per segment: RMS toward −20 dBFS with a peak ceiling of −1.5 dBFS.
   3. Add the pacing pauses.
   4. **Shift the word timings to match every trim and pad**, with tests.
2. **Playback.**
   - Two alternating `HTMLAudioElement`s (preload the next one) play WAV blobs, with `preservesPitch = true` and `playbackRate = speed`. Speed changes are instant and keep pitch.
   - Word timings are in media time, so sync doesn't depend on rate.
   - Above 2.0×, synthesize upcoming segments at model speed 1.25 and divide the playback rate to match. This keeps intelligibility at up to 4×; confirm with a listening test and an ADR.
3. **Prefetch scheduler.**
   - Keep at least 20 s or 4 segments of audio ready ahead of the playhead.
   - Run one concurrent job on WebGPU, and at most 2 WASM workers.
   - Use a priority queue by distance from the playhead.
   - On seek, cancel stale jobs with `AbortSignal`.
4. **Estimated word timings** for engines without native timings (Piper, OpenAI):
   1. Distribute the voiced duration across words, weighting by a syllable/phoneme estimate per word, plus pause weights for punctuation.
   2. Refine with energy-based silence detection (10 ms frames; gaps over 80 ms): snap the ends of words followed by punctuation to the nearest gap.
   3. **Target:** mean absolute boundary error ≤ 120 ms against Kokoro's native timings on a 200-sentence corpus. This is a test in M7.
5. **Synthesis cache** (IndexedDB `audio`).
   - **Key:** SHA-256 of `engineId|modelId|modelVersion|voiceId|speed|normalizerVersion|spokenText`.
   - **Value:** Int16 PCM, sample rate, word timings, size and last-used time.
   - **Eviction:** LRU, default cap 512 MB (configurable).
   - **Uses:** instant re-reads, and instant resume after the engine host restarts.

### 5.5 Player state machine (XState v5)

- **States:** `idle → preparing → buffering → playing ⇄ paused`, plus `seeking`, `ended`, and `error ⇄ retrying`.
- **Events:**
  - Transport: `PLAY`, `PAUSE`, `TOGGLE`, `STOP`.
  - Navigation: `SEEK(position)`, `NEXT_SENTENCE`, `PREV_SENTENCE`, `NEXT_BLOCK`, `PREV_BLOCK`.
  - Settings: `SET_SPEED`, `SET_VOICE` (re-buffer from the current sentence), `SET_PACING`.
  - Synthesis: `SEGMENT_READY`, `SEGMENT_FAILED`.
  - Audio: `AUDIO_ENDED`, `AUDIO_STALLED`.
  - Host and document: `HOST_LOST`, `HOST_RESTORED`, `DOC_CHANGED`.
  - Timer: `SLEEP_TIMER_FIRED`.
- **Invariants**, enforced in tests:
  - never two segments audible at once;
  - position is monotonic while playing;
  - every `playing` state has a live audio clock;
  - `error` is never terminal without a user-visible action;
  - the persisted position is updated on every sentence boundary.

  Use XState's model-based testing utilities if they are compatible with v5. Otherwise write exhaustive table-driven transition tests.

---

## 6. Voices and models (swappable, with a strong default)

### 6.1 Registry

`models/registry.json` is the bundled catalogue. It is validated by zod at build time and at runtime.

```ts
interface ModelManifest {
  id: string;                      // 'kokoro-82m-v1-timestamped'
  engine: 'kokoro' | 'piper' | 'system' | 'elevenlabs' | 'openai' | 'test';
  displayName: string;
  version: string;
  license: { spdx: string; url: string; notice?: string; personalUseOnly?: boolean };
  sizeBytes: number;
  sampleRate: number;
  files: { path: string; url: string; sha256: string; bytes: number; backend?: 'webgpu' | 'wasm' }[];
  voices: { id: string; name: string; lang: string; gender?: string; sampleUrl?: string }[];
  defaultVoice: string;
  caps: { wordTimings: 'native' | 'estimated'; backends: ('webgpu' | 'wasm' | 'remote')[] };
}
```

**Swapping models**

- The Voices & models page lists every catalogue entry with install, remove and set-as-default.
- **Custom models:**
  - add any Piper voice by ID (optionally browse Piper's `voices.json` catalogue on Hugging Face, fetched only when the user asks);
  - or import `.onnx` + `.json` files from disk for fully offline installs.
- **Adding a new engine** means writing one adapter that implements `RenderEngine`, plus one registry entry. Document this in `docs/MODELS.md` with a worked example.

### 6.2 Default model: Kokoro-82M v1.0 (timestamped), voice `af_heart`

**Why Kokoro.**

- It is a StyleTTS 2 model with 82M parameters, licensed Apache-2.0.
- It reached the top of the Hugging Face TTS Arena (v1) leaderboard, and it is generally more natural than Piper.
- The **timestamped ONNX export** (`onnx-community/Kokoro-82M-v1.0-ONNX-timestamped`) returns `{ waveform, durations }`, where `durations` are frames per input token. That gives **native word timings** for a precise cursor.
- Output is 24 kHz.

**Files and backends.**

- WebGPU: `onnx/model.onnx` (fp32, about 326 MB; recommended for WebGPU). Try `model_fp16.onnx` (about 163 MB) on the owner's GPU and keep it if it sounds the same.
- WASM fallback: `onnx/model_quantized.onnx` (q8, about 92 MB).
- Voices: `af_heart` (default), plus `am_michael`, `bf_emma` and `bm_george` as alternates.

**Phonemization without GPL.** Follow the approach of **HeadTTS** (MIT), which runs this exact model in the browser with word timestamps:

- a CMU-dictionary lookup;
- a rule-based fallback for words not in the dictionary;
- a mapping to Kokoro's Misaki phoneme set;
- word times computed from cumulative token durations.

You can use HeadTTS's in-browser worker as a dependency **only** if every asset can be loaded from extension-local URLs or OPFS: its `transformersModule`, `dictionaryURL`, `voiceURL` and model files all default to CDNs. Otherwise implement the adapter directly with transformers.js (`StyleTextToSpeech2Model`, `AutoTokenizer`) or raw onnxruntime-web, porting HeadTTS's timing logic and crediting it in `THIRD_PARTY.md`.

**Performance reality.** HeadTTS reports Chrome WebGPU fp32 at a real-time factor of about 0.27–0.30 on an M2 MacBook Air, roughly 3× faster than real time. WASM q4 runs at about 2.9, slower than real time. A 2026 CPU benchmark likewise measured Kokoro at 1.28× real-time cost per core, against Piper's 0.35×. So **Kokoro is the default where WebGPU is fast enough, and the extension falls back to Piper automatically** (§6.4).

### 6.3 Fast on-device fallback: Piper (the "Classic" voice)

- **Implementation:** run Piper in the browser with `@mintplex-labs/piper-tts-web` (MIT, a fork of vits-web), or directly with onnxruntime-web plus a piper-phonemize/eSpeak NG WASM build.
  - eSpeak NG is GPL-3.0. That's acceptable for personal use, but note it in `THIRD_PARTY.md`.
  - Override every CDN path so all code is bundled.
- **Voices:**
  - `en_US-lessac-high` (about 114 MB), the voice used for the owner's PSBT audiobook, which they liked. **Its training data (Blizzard 2013 Lessac) is licensed for research use only**, so mark it `personalUseOnly: true` and show the notice when installing.
  - `en_US-lessac-medium` (about 63 MB, faster).
  - `en_US-ljspeech-high` (public-domain training data).
- **Settings that matched the owner's preferred sound:** `length_scale 1.1`, normalized audio, volume 0.9, with each sentence's silence trimmed and replaced by structural pauses (§5.2.5).
- **Word timings:** estimated (§5.4.4).

### 6.4 Backend detection and automatic selection

On first run, and on demand from settings, run a 10-second benchmark:

1. Probe `navigator.gpu` (adapter info and limits) inside the engine host's worker.
2. Synthesize three reference sentences with Kokoro on WebGPU (if available) and on WASM, and with Piper; measure the real-time factor and time to first audio.
3. Choose the default engine:
   - Kokoro on WebGPU if its RTF ≤ 0.6;
   - otherwise Piper lessac-high if its RTF ≤ 0.6;
   - otherwise Piper lessac-medium.

   Store the result and show it on the Voices & models page ("Kokoro · WebGPU · 3.4× real-time").
4. At runtime, if the measured RTF stays above 0.9 for 30 seconds (playback starving), suggest switching to the faster voice. Never switch silently mid-sentence.

### 6.5 System voices: zero-download fallback

- `chrome.tts`, with `requiredEventTypes: ['word', 'end']` when the voice supports them.
- Word events give `charIndex`, the start of the next word.
- Voices marked `remote: true` are online. Label them as such and exclude them in strict offline mode.
- Used when no model is installed, or as the explicit choice.

### 6.6 Online voices (opt-in, M12)

- **Off by default.** Turning one on requires an API key, stored in `chrome.storage.local` and never synced. The UI always shows which provider receives the text, and only the current and next segments are sent.
- **ElevenLabs:** use the *convert with timestamps* or *stream with timestamps* endpoints. Their character-level alignment becomes native word timings.
- **OpenAI TTS:** timings are estimated.
- The adapter interface makes Azure or Google simple to add later.
- **Contract tests use msw mocks only.** No real network in CI.

### 6.7 Model manager

- **Download.**
  - Streamed `fetch` with progress, saved as resumable chunks in OPFS.
  - Verify SHA-256 after download, then mark the model installed.
  - Pause, resume, cancel, and a retry button on failure.
- **Load at engine init.** Pass `ArrayBuffer`s or object URLs straight to ONNX Runtime from OPFS, with no network. Point transformers.js and onnxruntime-web WASM paths at bundled files: `env.allowRemoteModels = false` after install, local `wasmPaths`, and a custom cache backed by OPFS if transformers.js is used.
- **Offline pack.** `pnpm models:fetch` downloads the default model into `public/models/` (gitignored), so `pnpm build:offline` produces a build with the model bundled for fully offline installs.
- **Integrity checks** on every load (size, and a SHA-256 spot check), with a "Repair model" action.

---

## 7. Web mode in detail

### 7.1 Extraction with live-DOM mapping (the key trick)

1. Clone the document. Walk the **pristine clone** and record a `Map<Text, number[]>`: each **text node's** child-index path from `<html>`.
2. Run `new Readability(clone, { serializer: el => el })` so the article **element** is returned instead of an HTML string.
   - Readability moves nodes into a new container and re-tags some elements by creating replacements (`_setNodeTag`), so element identity is not preserved.
   - The original **text nodes** do survive, so map at the text-node level.
3. Walk the article element's text nodes in order:
   1. Look up each node's recorded path and resolve it in the **live** DOM.
   2. Verify that the live node's text matches.
   3. Group the nodes into blocks following the article's block structure (`p, h1–h6, li, blockquote, pre, figcaption, td`, and so on).
   4. If any node fails to resolve, fall back to a text-fingerprint search (n-gram shingles) within the live article region for that block.
4. Build the blocks and `AnchorRun`s to live `Text` nodes, through a node registry (`nodeRef → WeakRef<Text>`).
5. **If Readability fails** (not an article), use "visible text" mode: walk `document.body` in order, skipping `nav, header, footer, aside, script, style, noscript, [hidden], [aria-hidden=true]`, invisible elements and form controls.
6. **v1 limits:** skip iframes and closed shadow roots, and don't break on open ones. A Chrome-PDF-viewer tab shows an "Open in Open Reader" button instead (§8.1).
7. **Changing pages.** A `MutationObserver` watches for removed or replaced anchored nodes (SPAs). Re-map by fingerprint; if that fails, keep reading and highlight only in the side panel's reader view, with a small note.

### 7.2 Highlighting and the cursor

- **CSS Custom Highlight API:**
  - `CSS.highlights.set('or-sentence', new Highlight(range))` and `'or-word'`;
  - styles via `::highlight(or-sentence)` and `::highlight(or-word)`, injected once.
  - It doesn't change the page DOM, so it's safe on any site.
- **Cursor:** an overlay in a closed shadow root, positioned from `range.getClientRects()` and updated on word change, scroll and resize. It is driven by the local clock (§4.3).
- **Theme on the page:** detect the page's background luminance and choose the light or dark highlight variant.

### 7.3 Follow-scroll and interaction

- **Follow-scroll.** Keep the current sentence in a comfortable band, 25–65% of the viewport height, with smooth scrolling (instant under reduced motion). Any user scroll, wheel or touch suspends following for 5 seconds, and the mini player shows "Resume follow".
- **Starting points.** Read from here: Alt+click a word, or use the "Play from here" button that appears near the selection. Context menu items: "Read selection aloud" and "Read page from here".
- **Side panel.** Transport, an outline (jump to a heading), and the reader view (blocks rendered from the model, never page HTML, so nothing can inject markup), with synced highlight and click-to-seek.
- **Keyboard (in-page, while a session is active):**

  | Key | Action |
  |---|---|
  | Space | Play/pause (only if focus isn't in an input) |
  | J / K | Previous/next sentence |
  | Shift+J / Shift+K | Previous/next paragraph |
  | − / = | Speed down/up |
  | F | Toggle follow |
  | Esc | Stop |

---

## 8. Document mode (PDF) in detail

### 8.1 Opening PDFs

Ways in:

- the "Open a PDF…" file picker in the side panel menu, the onboarding screen and the reader page;
- drag and drop onto the reader page;
- the context menu on links ending in `.pdf` ("Read PDF in Open Reader");
- a side-panel button when the active tab is Chrome's PDF viewer (fetch the URL);
- optional interception: a setting, off by default, adds a declarativeNetRequest rule that redirects top-level `.pdf` navigations to `reader.html?src=…`.

For `file://` PDFs, check `chrome.extension.isAllowedFileSchemeAccess()` and walk the owner through enabling "Allow access to file URLs".

Store opened PDFs in OPFS, deduplicated by SHA-256, so the library reopens them offline.

### 8.2 Rendering

- Use `pdfjs-dist` 6.x's `PDFViewer` with `EventBus`, `PDFLinkService` and `PDFFindController`, and its text layer.
- Set `GlobalWorkerOptions.workerSrc` and the WASM decoder paths to bundled files.
- Lazy rendering, zoom (fit width, fit page, percentages), thumbnails and the outline in the left drawer.
- Apply highlights after each page's text layer renders (`textlayerrendered`).

### 8.3 Layout analysis

Run it in a worker, page by page and incrementally, building blocks with PDF anchors:

1. **Items.** From `page.getTextContent()`, compute each item's bounding box from `transform` (x, y, font size = `hypot(t[2], t[3])`), its width and `hasEOL`.
2. **Lines.** Group items by baseline (|Δy| < 0.5 × font size) and sort by x. Insert a space when the gap is more than 0.25 × font size.
3. **Columns.** Find gutter bands (vertical whitespace spanning ≥ 60% of the text area height). Split lines by gutter and order columns left to right.
4. **Blocks.**
   - Merge consecutive lines into a paragraph when the line gap is ≤ 1.5 × the median gap and the font size is similar.
   - Treat larger or bolder short lines as headings.
5. **Dehyphenation.** When a line ends with `-` and the next line starts with a lowercase letter, join them without the hyphen. Keep the mapping so highlights still cover both fragments.
6. **Headers and footers.** Lines in the top or bottom 7% of the page whose digit-normalized text repeats on ≥ 40% of pages are skipped, as are standalone page numbers.
7. **References.** A heading matching `references|bibliography|works cited` starts a "reference" region (skipped by default). Lines starting `Figure n` or `Table n` are captions.
8. **Override.** Clicking any word starts reading there, whatever the computed order. Show a "reading order" debug overlay (numbered blocks) in Diagnostics.

### 8.4 Cursor and highlights on the PDF

- **Map PDF anchors to the DOM.** PDF.js's text layer creates one span per text item, in the same order as `textContent.items`. Map `(page, item, offset)` to a span's text node and offset, then to a `Range`.
- **Highlights.** Paint with the same CSS highlights (the text layer text is transparent, and the highlight background shows). The word cursor overlay sits in the page container.
- **Follow-scroll** moves through pages and renders the target page first if needed. Respect the user's scroll the same way as in Web mode.

### 8.5 OCR for scanned PDFs (M13, optional)

Pages with no text items get OCR with **tesseract.js 7.x** in a worker, using bundled core, worker and `eng` traineddata, with no CDN. The OCR word boxes form our own text layer overlay, and the rest of the pipeline is unchanged. Before running OCR, show "Recognizing text on page n…" with progress.

---

## 9. Reliability, performance and recovery

### 9.1 Service-level objectives

Measure these on the owner's machine and record the specs in `docs/TESTING.md`:

| Metric | Target |
|---|---|
| Time to first audio, warm voice | ≤ 800 ms (Kokoro on WebGPU, or Piper) |
| Cold start (load from OPFS + init), with progress UI | ≤ 6 s |
| Stalls mid-playback on reference documents | Zero |
| Buffer ahead of the playhead | ≥ 20 s |
| Recovery after the engine host restarts or the service worker is killed | Resume at the same sentence within 3 s |
| Position persisted | On every sentence boundary; reopening a document resumes within one sentence |
| Highlight drift | ≤ 50 ms over a 10-minute session |
| Side panel JS (excluding engines) | ≤ 300 KB gzipped |
| PDF: first page of a 100-page PDF | ≤ 2 s |
| PDF: layout analysis | ≤ 50 ms per page in the worker |
| Memory (Kokoro fp32 on WebGPU, plus a 100-page PDF) | ≤ 1.5 GB |

### 9.2 Failure handling

- **Offscreen document closed** (the 30 s rule after a pause, or a crash):
  1. The background detects the port disconnect and marks `HOST_LOST`.
  2. On the next Play, it recreates the document and restores the session from `storage.session`.
  3. Cached audio for the current and next segments (prefetched before the pause) plays immediately while the engine warms in parallel.
- **Service worker restarts:** all routing state is in `storage.session`. Ports reconnect with exponential backoff.
- **Watchdog:** if the player is `playing` but media time hasn't advanced for 2 seconds, re-buffer. After three failures, restart the engine worker and show a toast.
- **Engine errors:** retry once on the same backend, then on the fallback backend (WebGPU, then WASM), then the fallback engine. Every switch is visible ("Switched to Piper because WebGPU failed — Details").
- **Diagnostics.**
  - A ring-buffered log (with no document text by default).
  - Live stats: RTF, cache hit rate, buffer depth, backend, errors.
  - A "Copy diagnostics" button (JSON) and a "Reading order overlay" toggle for PDFs.

---

## 10. Privacy and security

- No analytics or telemetry. The only network calls are user-initiated model downloads (Hugging Face) and opt-in online voices.
- Document text never leaves the device in offline mode.
- API keys live in `storage.local` and are excluded from diagnostics exports.
- No `eval` or remote scripts, per the CSP. The reader view renders from the block model, never from page HTML.
- The content script runs in the isolated world. The mini player and cursor live in closed shadow roots.
- Run `pnpm audit` in CI. Every new dependency needs a license check.
- Write `docs/PRIVACY.md` explaining the broad host permission and what is stored where.

---

## 11. Testing strategy

| Layer | Tooling | What it covers |
|---|---|---|
| **Unit** | Vitest, WXT `WxtVitest` plugin, `fakeBrowser` | Text pipeline (golden tests, offset-map properties), segmentation edge cases, skip rules, lexicon, pacing, WAV/trim/loudness, timing shift and estimation, prefetch scheduler, cache LRU, registry and settings schemas, player machine (transition tables or model-based), PDF layout algorithm (fixtures as JSON text content) |
| **Browser unit** | Vitest browser mode (Playwright provider) | Anything needing real DOM APIs: `Range` rects, CSS Custom Highlight API, `Intl.Segmenter`, OPFS, IndexedDB, Readability mapping on fixture pages |
| **E2E** | Playwright with a **persistent context**, `channel: 'chromium'` (headless works), `--load-extension` / `--disable-extensions-except` pointing at the build, `--autoplay-policy=no-user-gesture-required` | Real extension flows with the **TestEngine** |
| **Model smoke** (`pnpm test:models`, tagged `@slow`) | Playwright | Real Kokoro (WASM in CI, WebGPU locally) and Piper: non-silent audio, correct sample rate, monotonic timings inside the audio, RTF logged |
| **Offline** | Playwright | After model install: `context.setOffline(true)` and abort every network route, then read a page and a PDF successfully |
| **Accessibility** | `@axe-core/playwright` | Side panel, reader page, options page, onboarding: zero serious or critical violations |
| **Visual regression** | Playwright screenshots | Key screens in light and dark; update only on deliberate design changes |
| **Soak** | TestEngine at accelerated rate | 60 minutes of simulated playback: memory stays flat, no drift beyond budget, positions persisted |
| **Audio quality** (local, before releases) | `quality/asr_qa.py` (faster-whisper, Python, uv) | See below |
| **Lint and types** | ESLint, `tsc --noEmit` | Every commit |

**Extension E2E details**

- Get the extension ID from the service worker URL: `context.serviceWorkers()[0].url().split('/')[2]`.
- **Side panel:** open `chrome-extension://<id>/sidepanel.html?tabId=<n>` in a normal page. The side panel accepts a `tabId` query parameter so tests can target a tab, because a real side panel can't be opened programmatically without a gesture.
- **Events:** a test-only debug channel (enabled only in `MODE=test` builds) records player events, which tests read through the service worker.
- **Scenarios:**
  - read a fixture blog post and assert the highlighted word text advances in order;
  - pause, wait 35 s (to trigger the offscreen 30 s rule) and resume at the same sentence;
  - kill the offscreen document mid-play and confirm recovery;
  - change speed while playing;
  - click-to-read;
  - read a selection;
  - in a two-column PDF, assert reading order and the cursor position on page 2;
  - skip headers and footers;
  - library resume after a reload.

**TestEngine.** A deterministic render engine:

- 60 ms per character at 1×, divided by speed;
- a quiet sine tone so the audio elements genuinely play;
- exact word timings;
- configurable failure injection (fail the nth segment, stall, slow start).

**Fixtures** (`scripts/make-fixtures.ts`):

- **Web:** a blog post, a docs page with code, a Wikipedia-like page with citations, a long post with lists and tables, an SPA that re-renders, and a dark-theme page.
- **PDF** (generated with pdf-lib):
  - single column;
  - two columns;
  - headers, footers and page numbers;
  - hyphenation across lines;
  - a references section;
  - an image-only page (for OCR);
  - each with a golden expected reading order in JSON.
- **Corpus:** the owner's own articles (their PSBT and Taproot deep dives), used for long-form and pronunciation tests.

**Quality harness** (mirrors how the owner's audiobook was verified):

1. Render a corpus with each engine (`scripts/synth-corpus.ts` drives headless Chrome).
2. Transcribe each segment with faster-whisper (`base.en`, or `small.en` if available).
3. Compute word error rate per segment after normalization: join spelled letters like "P S B T" to "psbt", map number words to digits, and alias known spellings.
4. Report the worst segments.

**Gates:** overall WER ≤ 8%, and no regression above 1 point between runs. This catches normalization and lexicon regressions.

**Coverage:** ≥ 90% for `src/core/**`, ≥ 75% overall, enforced in CI.

**CI** (GitHub Actions, Ubuntu):

```text
pnpm install --frozen-lockfile → lint → typecheck → unit (+ coverage)
→ build → playwright install chromium → e2e (TestEngine) → upload report and zip
```

Model smoke tests run on `workflow_dispatch`, with a cache of the model files.

**Pre-commit:** lint-staged, plus unit tests for changed packages (lefthook or husky).

---

## 12. Definition of Done (every milestone) and the commit protocol

1. The milestone's acceptance criteria (§13) are met, and its new tests exist and pass.
2. `pnpm lint && pnpm typecheck && pnpm test && pnpm build && pnpm test:e2e` are all green. Add `pnpm test:models` when engines changed.
3. For UI milestones, the `web-design-guidelines` and `accessibility` review passes are done and their findings fixed. axe is clean, and screenshots are updated deliberately.
4. Docs are updated: `PROGRESS.md`, any relevant `docs/*.md`, and new ADRs.
5. For anything that needs the owner's browser, a short manual QA script is added to `docs/PROGRESS.md`: load unpacked from `.output/chrome-mv3`, then the steps to try.
6. **Commit exactly once, with a single line:** `git add -A && git commit -m "M<n>: <summary>"`. No body, no trailers.

---

## 13. Milestones

Each milestone lists its goal, the work, the tests, and the exact commit message.

### M0: Bootstrap, tooling and skills

- Initialize the project with `pnpm dlx wxt@latest init` (React template), using `srcDir: 'src'`. Then add:
  - Tailwind v4 (`@tailwindcss/vite`), ESLint, Prettier, Vitest (`WxtVitest`), Playwright with an extension fixture, and lefthook;
  - the CI workflow, and `.gitignore` (models, `.output`, test results);
  - the docs skeleton, and this plan saved as `PLAN.md`.
- **Install the four UI/UX skills (§2)** after reading their sources. Record the versions installed in `docs/PROGRESS.md`.
- Add placeholder entrypoints (background, content, side panel, reader, offscreen, options, onboarding) that build and load.
- **Tests:**
  - one unit test;
  - one E2E test that loads the extension, reads its ID and opens `sidepanel.html`.
- Commit: `M0: bootstrap Open Reader with WXT, tooling, CI and UI skills`

### M1: Feasibility spikes and ADRs (de-risk before building)

Build small throwaway demos under `spikes/` (excluded from the build) and write one ADR per spike with measurements.

1. Run Kokoro timestamped ONNX in a worker inside the **offscreen document**:
   - confirm WebGPU is available there;
   - confirm the output names (`waveform`, `durations`) and the frame-to-seconds conversion;
   - produce correct word times for 5 sentences;
   - measure RTF on WebGPU and on WASM.
2. Run Piper lessac-high in a WASM worker, with every asset bundled and no CDN. Measure RTF.
3. Check offscreen audio playback:
   - `preservesPitch` at 0.75×, 1.5×, 2.5× and 3.5×;
   - the 30-second closure after a pause, and detecting it;
   - recreating the document.
4. Check the CSS Custom Highlight API on three real sites, with the Readability node-identity mapping.
5. Map the PDF.js 6.x text layer back to item and offset, and highlight a word on page 3 of a two-column PDF.
6. Check OPFS write and read speed for a 326 MB file, `navigator.storage.persist()`, and quotas.

- **Acceptance:** every spike has an ADR saying "works as planned" or describing the fallback chosen.
- Commit: `M1: feasibility spikes for engines, offscreen audio, highlights and PDF`

### M2: Design system and app shells

- Tokens (light and dark), bundled fonts and all components from §3.4, built with the **frontend-design** and **minimalist-ui** skills.
- Shells for the side panel, reader page, options page, onboarding and mini player, using mock data and a mock player.
- Theme switching (system, light, dark) and reduced-motion support.
- **Tests:** component tests, axe (zero serious or critical issues), keyboard navigation tests, and screenshot baselines in light and dark.
- Commit: `M2: black and off-white design system and app shells`

### M3: Document model and text pipeline

- `core/document` and `core/text` as specified in §5.1–§5.2: segmentation, skip rules, normalization with offset maps, lexicon with built-in packs, pacing plan, and spoken segments.
- **Tests:**
  - golden tests (more than 300 cases), including every pronunciation issue found in the owner's audiobook;
  - property tests that every spoken word maps back to a valid source range (fast-check);
  - segmentation edge cases.
- Commit: `M3: reading document model and text normalization pipeline`

### M4: Audio pipeline and player core

- The engine and backend interfaces, TestEngine, worker RPC, post-processing (trim, loudness, pauses, timing shift), WAV encode, `RenderedBackend` (dual audio elements, `preservesPitch`), the timing clock and sync protocol (§4.3), the prefetch scheduler, the IndexedDB synthesis cache, and the XState player.
- **Tests:**
  - all player invariants (§5.5);
  - the timing-shift math;
  - scheduler cancellation;
  - cache LRU;
  - drift under rate changes.
- Commit: `M4: audio pipeline, player state machine and synthesis cache`

### M5: Extension runtime, hosts and messaging

- The background orchestrator, `OffscreenHost` (create, detect, recreate, the 30-second rule), `InPageHost`, typed messaging and ports, the single-active-session rule, `storage.session` persistence and recovery, `chrome.commands`, context menus, and the side panel's opening behaviour.
- **Tests (E2E with TestEngine):**
  - play, pause and resume;
  - resume after the offscreen document is closed (forced and by the 35-second pause);
  - service-worker restart;
  - commands via evaluate;
  - two sessions never both audible.
- Commit: `M5: extension runtime with resilient engine hosts and messaging`

### M6: Model manager and the default engine (Kokoro)

- The registry and schema, OPFS downloader (progress, resume, SHA-256), install, remove and repair, and the Voices & models page plus onboarding download.
- The Kokoro adapter (native word timings), WebGPU/WASM selection, and the benchmark with auto-selection (§6.4).
- `pnpm models:fetch` and `pnpm build:offline`.
- **Tests:**
  - downloader unit tests (with mocked streams and corrupted chunks);
  - model smoke tests;
  - the offline E2E (network disabled after install);
  - a timings sanity check (monotonic, inside the audio, matching the word count).
- Commit: `M6: model manager and Kokoro on-device engine with word timings`

### M7: Piper, system voices and the voice bake-off

- The Piper adapter (lessac-high "Classic", lessac-medium, ljspeech-high) with estimated timings; the `LiveBackend` for `chrome.tts` with word events; license notices in the UI.
- The quality harness (`quality/`).
- **Bake-off:** render 10 reference passages with each voice.
  - Report RTF, time to first audio, WER, and the timing error of Piper's estimates against Kokoro's native timings (target ≤ 120 ms).
  - **Ask the owner to listen and confirm the default voice.** Record the decision in an ADR.
- Commit: `M7: Piper and system voice engines with quality bake-off`

### M8: Web mode, end to end

- Extraction with live-DOM mapping (§7.1), highlight painter and cursor, follow-scroll, click-to-read, read selection, mini player, side panel (transport, reader view, outline, time remaining), in-page keyboard shortcuts, and resume per URL.
- **Tests:**
  - E2E on every web fixture: highlights advance in order, scroll follows, user scroll suspends following, SPA re-render recovery, dark-page contrast;
  - browser unit tests for the mapping.
- Run the UI review passes with the skills.
- Commit: `M8: web mode with live highlighting, cursor and side panel reader`

### M9: Document mode (PDF), end to end

- Opening flows (§8.1), the PDF.js viewer, the layout-analysis worker (§8.3), the anchor-to-text-layer mapping, word cursor and sentence highlight, follow across pages, click-to-read, thumbnails and outline, search, zoom, library and resume, and reading-rules settings.
- **Tests:**
  - reading-order goldens for every fixture PDF;
  - E2E: cursor on the correct word in the right column, header/footer skipping, references skipping, resume after reload;
  - performance check on a generated 100-page PDF.
- Commit: `M9: document mode with PDF reading order and word cursor`

### M10: Reliability, performance and diagnostics hardening

- The watchdog and the error/fallback ladder (§9.2), retry with backoff, memory caps, and cache-eviction policies.
- The Diagnostics page (stats, logs, copy JSON, reading-order overlay), and the performance budgets checked in CI where possible.
- The soak test.
- Revisit COOP/COEP and multi-threaded WASM only if the numbers justify it, with an ADR.
- **Acceptance:** the SLO table (§9.1) is measured and recorded; any misses get ADRs with a plan.
- Commit: `M10: reliability hardening, diagnostics and performance budgets`

### M11: Power features

- The pronunciation editor (test button, import and export) and domain packs.
- The skip-rules UI per document, the sleep timer (minutes, or end of section), pacing presets, and speed up to 4×.
- **Audiobook export** of the current page or PDF:
  - a background job with progress and cancel;
  - output loudness-normalized to −17 LUFS integrated (−1.5 dBTP peak), the same target as the owner's PSBT audiobook;
  - MP3 at 64 kbps mono via wasm-media-encoders, or WAV;
  - an ID3v2.3 CHAP/CTOC chapter per heading;
  - saved through `chrome.downloads`.
- **Tests:** a chapter round-trip with `music-metadata` (and `ffprobe` if installed), exported duration matching the playback plan, and the sleep timer.
- Commit: `M11: pronunciation editor, sleep timer and audiobook export`

### M12: Online voices (opt-in)

- The provider interface, the ElevenLabs adapter (timestamped endpoints become native timings), the OpenAI adapter (estimated timings), key management, a consent dialog, a network indicator, and a per-session provider badge.
- **Tests:** msw contract tests (success, rate limit, auth error, timeout), and an assertion that no network request happens while online voices are off.
- Commit: `M12: opt-in online voices with timestamped alignment`

### M13: OCR for scanned PDFs (optional)

- The tesseract.js worker with bundled assets, an OCR text-layer overlay, progress UI, and caching OCR results per document in IndexedDB.
- **Tests:** an image-only fixture produces readable text and a working cursor; an offline E2E.
- Commit: `M13: offline OCR for scanned PDFs`

### M14: Polish, audits and v1.0.0

- A full UI review with all four skills, and a final accessibility audit.
- Copy edits: short, plain labels.
- Empty states and error states everywhere.
- **Docs:**
  - README (install unpacked, first run, shortcuts, troubleshooting);
  - `ARCHITECTURE.md`, `MODELS.md` (adding a model or engine), `TESTING.md`, `PRIVACY.md`, `THIRD_PARTY.md`.
- Build the zip, bump to `1.0.0`, and tag `v1.0.0` after the commit.
- **Acceptance:** the full test suite, the offline E2E, the soak test and the quality harness all pass, and the owner completes a 30-minute real reading session in each mode without a stall.
- Commit: `M14: polish, audits, docs and v1.0.0`

---

## 14. Risks and mitigations

| Risk | Mitigation |
|---|---|
| No WebGPU, or a slow GPU, on the owner's machine (Kokoro WASM is slower than real time) | Automatic benchmark and fallback to Piper (§6.4); M1 spike measures it first |
| Offscreen document closes 30 s after a pause | Designed-in recovery plus an audio cache for instant resume (§9.2); E2E covers it |
| Library loads code from CDNs (transformers.js, ORT, piper-tts-web, PDF.js, tesseract.js) | Override every path to bundled files; the offline E2E blocks all network |
| Mapping extracted text back to the live DOM fails on complex sites | Node-identity path map, fingerprint fallback, and a reader-view highlight fallback |
| PDF reading order fails on complex layouts | Column detection with goldens, click-to-read override, and a debug overlay |
| Model licensing | Kokoro is Apache-2.0 (default). Piper lessac is research-only data, flagged `personalUseOnly`. LJSpeech is public domain. All recorded in `MODELS.md` |
| Large model files | OPFS with persistence, an offline-pack build, integrity checks and a repair action |
| Speed above 2× sounds artificial | Model-speed blend (§5.4.2) and a listening test |

---

## 15. References (checked October 2026)

- **Chrome extension APIs:**
  - [Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen): reasons, the 30-second `AUDIO_PLAYBACK` rule, runtime-only API.
  - [Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel).
  - [chrome.tts](https://developer.chrome.com/docs/extensions/reference/api/tts).
- **Testing:**
  - [Playwright: Chrome extensions](https://playwright.dev/docs/chrome-extensions) (persistent context, `channel: 'chromium'`, headless, extension ID).
  - [WXT unit testing](https://wxt.dev/guide/essentials/unit-testing) (`WxtVitest`, `fakeBrowser`).
- **Kokoro:**
  - [Kokoro-82M v1.0 ONNX (timestamped)](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX-timestamped).
  - [kokoro-js](https://www.npmjs.com/package/kokoro-js).
  - [HeadTTS](https://github.com/met4citizen/HeadTTS): MIT, Kokoro in the browser with word timestamps; reference for G2P and timing.
- **Piper:**
  - [piper-tts-web](https://github.com/Mintplex-Labs/piper-tts-web).
  - [Piper voice model cards](https://huggingface.co/rhasspy/piper-voices) (lessac data license: research only; LJSpeech: public domain).
- **Benchmark:** [Picovoice on-device TTS benchmark 2026](https://picovoice.ai/blog/on-device-tts/).
- **UI/UX skills:**
  - [anthropics/skills · frontend-design](https://github.com/anthropics/skills).
  - [taste-skill · minimalist-ui](https://skills.sh/leonxlnx/taste-skill/minimalist-ui).
  - [vercel-labs/agent-skills](https://github.com/vercel-labs/agent-skills).
  - [addyosmani/web-quality-skills](https://github.com/addyosmani/web-quality-skills).
  - Install rankings: [Skillselion (design)](https://skillselion.com/design), [claudeskills.info (UI/UX)](https://claudeskills.info/best/ui-ux-skills/).
- **Online voices:** [ElevenLabs: speech with timestamps](https://elevenlabs.io/docs/api-reference/streaming-with-timestamps).

*End of plan. Start with M0.*