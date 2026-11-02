# Progress

## Milestones

- [x] M0: Bootstrap, tooling and skills
- [x] M1: Feasibility spikes and ADRs
- [x] M2: Design system and app shells
- [x] M3: Document model and text pipeline
- [x] M4: Audio pipeline and player core
- [x] M5: Extension runtime, hosts and messaging
- [x] M6: Model manager and the default engine (Kokoro)
- [x] M7: Piper, system voices and the voice bake-off
- [x] M8: Web mode, end to end
- [x] M9: Document mode (PDF), end to end
- [x] M10: Reliability, performance and diagnostics hardening
- [x] M11: Power features
- [ ] M12: Online voices (opt-in) — skipped at the owner's request (2026-10-29)
- [x] M13: OCR for scanned PDFs (optional)
- [x] M14: Polish, audits and v1.0.0 — the `v1.0.0` tag waits for the owner's 30-minute session in each mode (M14 QA below)

## Decisions

| ADR                                                     | Decision                                                                                                        |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| [0001](adr/0001-toolchain-versions.md)                  | TypeScript 6.0 and ESLint 9 (newest typescript-eslint and jsx-a11y support)                                     |
| [0002](adr/0002-ui-skills.md)                           | UI skills vendored at project scope from pinned commits; `minimalist-ui` now lives in `taste-skill-classics`    |
| [0016](adr/0016-document-mode.md)                       | PDF layout analysis, text-layer mapping, OPFS document store and opt-in PDF interception                        |
| [0017](adr/0017-reliability-diagnostics-and-budgets.md) | Fallback ladder, diagnostics, budgets, soak test, SLO results; COOP/COEP stays off; memory miss plan            |
| [0018](adr/0018-onnx-external-data-and-idle-release.md) | WebGPU weights load as external data (WASM heap 757 → 33 MB); idle engines released after 5 min                 |
| [0019](adr/0019-power-features-and-audiobook-export.md) | Pronunciation editor, per-document rules, sleep timer, audiobook export (−17 LUFS, MP3/WAV, chapters)           |
| [0020](adr/0020-offline-ocr.md)                         | Offline OCR with bundled tesseract.js: OCR words become PDF items, own text layer, per-page cache               |
| [0021](adr/0021-ux-follow-the-tab.md)                   | The side panel follows the tab in front; sessions end with their page; PDF entry points everywhere; Recent list |

## UI/UX skills installed (M0)

Installed into `.claude/skills/` by copying from pinned commits after reading every file
(none ship scripts). See ADR 0002.

| Skill                   | Source                                                                                  | Commit                                                                                  |
| ----------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `frontend-design`       | `anthropics/skills`                                                                     | `ca45fc496a3436251f191354091d557da31c15b5`                                              |
| `minimalist-ui`         | `Leonxlnx/taste-skill-classics` (`skills/minimalist-skill`)                             | `5e08c9383dc4ad7fc0df70e1ac8cfa09ec356305`                                              |
| `web-design-guidelines` | `vercel-labs/agent-skills` + pinned `vercel-labs/web-interface-guidelines` `command.md` | `1a2c79d4e6c4a2283dc2c614b6538cbe1ed5ca62` / `434b7f91364665f2f733b310ec54809bf8f37937` |
| `accessibility`         | `addyosmani/web-quality-skills`                                                         | `afa8da942115f2961fdbfa80807ea0b232ff6c00`                                              |

## Environment

- Development machine: Apple M3 Max, macOS 26.6, Node 22.14, pnpm 10.9.
- Playwright Chromium (headless shell) 156.

## Known issues

- **Voices**
  - Kokoro's f16 variants are silent on Apple M3 Max WebGPU, so the GPU holds fp32 weights
    (326 MB); revisit with newer onnxruntime-web (ADR 0003, ADR 0018).
  - HeadTTS's G2P reads a standalone spelled letter "A" (in acronyms such as "A P I") as "uh". Most
    acronyms are unaffected.
  - ASR heard "Schnorr" (respelled "shnor") as "snore"; confirm by ear (ADR 0014).
  - Speed above 2× (model speed 1.25 plus slower playback) has not had a dedicated listening test.
- **Web mode**
  - "Read page from here" before the first injection starts at the first visible block, not the
    exact right-click point.
  - The side panel's reader view renders every block; very long pages could use
    `content-visibility: auto` if it measures slow.
  - The content script is 366 kB (113 kB gzipped, budget 250 kB) because the mini player uses
    React; it is injected only on demand.
- **Document mode**
  - PDF reading order is heuristic (ADR 0016); use "Show reading order" to spot mistakes.
  - OCR is English only, and poor scans (handwriting, skew, low resolution) read badly (ADR 0020).
- **Tests**
  - Under full-suite load the E2E run occasionally fails one test that passes alone (seen twice in
    four runs at 1.0.0, a different test each time). CI retries once; the soak and timing tests
    pass on their own.
  - The soak's start-up settle (the first clock correction of each segment) measured 225–280 ms
    on the release machine against 65 ms in M10, probably audio-output latency; it is corrected
    300 ms into each segment, and steady-state drift stayed at 13–20 ms.
- **Other**
  - `navigator.storage.persist()` is refused in a fresh profile; Options → Storage can ask again.
  - Online voices (M12) were not built, at the owner's request.
  - The owner's own articles are not in `tests/fixtures/corpus/owner/`; the quality harness uses
    project-written passages.

## Spikes (M1)

Throwaway code under `spikes/` (excluded from build, lint and typecheck). Reproduce with
`pnpm spikes:setup && pnpm spikes:build && pnpm spikes:run`; results land in `spikes/out/` (gitignored).

## Manual QA scripts

### Post-1.0 UX pass (ADR 0021)

1. Read an article, pause, switch to another article tab: the panel shows a bar "Paused in another
   tab" and the new page with **Read this page**. Press it: the new article plays.
2. Close the first article's tab, or open a different page in it: its reading ends; nothing old
   resumes on Play.
3. On a new article with something paused elsewhere, press Alt+Shift+P: it reads the new page.
4. The PDF button at the top of the panel, ⋯ → **Open a PDF…**, and right-click on the toolbar icon
   → **Open a PDF…** all open the reader (not Settings).
5. Open `chrome://extensions` with the panel open: it says the page can't be read and offers a PDF.
6. **Recent** in the panel: an article reopens at your position; a PDF opens in the reader.

### M14 (release check)

Do one 30-minute reading session in each mode in your own Chrome, with your own voice and
documents. This is the last acceptance step before tagging v1.0.0.

1. **Web mode:** a long article (30+ minutes at your usual speed). Use the keyboard shortcuts,
   pause for a few minutes once, and let it run in the background while you switch tabs. Note any
   stall (silence longer than a sentence gap), wrong highlight, or bad pronunciation.
2. **Document mode:** a long PDF, ideally two columns with references. Read it with **Follow** on,
   zoom once, and click a word to jump.
3. Afterwards, Options → Diagnostics: stalls and errors should be 0. Copy the diagnostics if
   anything went wrong.

### M13

1. Open a scanned PDF (a photo or scan of printed text, no selectable text) in the reader. A
   status shows "Recognizing text on page 1… (1 of N)". Pages with real text can be played while
   it runs.
2. When it finishes, press Play: the word highlight and cursor sit on the scanned words, and
   clicking a word starts reading there.
3. Turn off Wi-Fi and open another scan: recognition still works.
4. Close and reopen the first PDF: there is no recognition step this time (cached).

### M11

1. Options → Pronunciations: add "Schnorr" said as "shnor", press **Test** and listen. Read a page
   that mentions it: the new pronunciation is used without restarting. Export the list, delete the
   entry (then **Undo**), and import the file again.
2. Turn off the Bitcoin pack and read a page with "PSBT": it is no longer spelled out.
3. Side panel → Settings → **Sleep timer** → 5 minutes. Reading pauses at a sentence end after
   5 minutes. Try **End of section**: it pauses at the next heading.
4. Under **Rules for this document**, turn off "Skip code blocks": the page is re-read with code,
   at the same sentence. Reload the page later: the rule is remembered. **Use my default rules**
   resets it.
5. **Export audiobook…** → MP3 → Start. Close and reopen the side panel while it runs; the
   progress is still there. Open the file from Downloads in a player that shows chapters (Apple
   Books, VLC): one chapter per heading, steady loudness. Try WAV once, and Cancel once.
6. In a PDF (reader → reading rules drawer), export an audiobook and set a sleep timer.
7. Options → Playback: set a default speed (up to 4×) and pauses; new sessions use them.

### M10

1. Start reading a page, then open Options → Diagnostics: state, engine and backend, real-time
   factor, buffer ahead (about 20 s or more), cache hit rate and zero stalls update every second.
2. The log lists commands and state changes but no text from the page. **Copy diagnostics** puts
   JSON on the clipboard; paste it somewhere and check it has no page text or keys.
3. Turn on **Reading order overlay for PDFs**, then open a PDF: the blocks are numbered.
4. Options → Storage shows real sizes for models, audio cache and stored PDFs. Change the audio
   cache limit, clear the audio cache, and remove stored PDFs.
5. Fallback (optional): in `chrome://flags` disable WebGPU, restart Chrome, and read a page with
   Kokoro on WebGPU selected. A notice says Kokoro switched to WASM, and reading continues.
6. Read for 10 minutes without touching anything: no pauses, and the word highlight stays on the
   word being spoken.
7. Open a long PDF, read with Kokoro, and check Chrome's Task Manager (⋮ → More tools): the
   extension row stays around 0.5 GB. Pause for 5 minutes, then press Play: it resumes at the same
   sentence after a short start.

### M9

1. Open the side panel and choose **Open a PDF…**, then pick a two-column paper. The first page
   appears quickly and a progress bar shows page analysis.
2. Press Play: the word under the voice is inverted and the bar glides beneath it; reading crosses
   from the left to the right column and on to the next page, skipping running headers, page
   numbers and the references section.
3. Click any word: reading jumps there. Scroll away: following pauses for 5 seconds.
4. Open the right drawer, turn on **Show reading order** and check the numbers follow the columns.
   Turn off **Skip references** and confirm they are read.
5. Use the Pages and Outline tabs, the zoom menu and search (Enter finds the next match).
6. Reload the tab: the document reopens from **Recent documents** and resumes where you stopped.
7. Optional: enable **Open PDF links in Open Reader** in Options → Reading rules, then open a PDF link.
   For a `file://` PDF, the reader explains how to allow file access.

### M8

1. Open a long article (e.g. a Wikipedia page) and press Alt+Shift+O, then **Read this page** in
   the side panel. The current sentence is tinted, the word is inverted and a thin bar glides under it.
2. Scroll with the wheel: the page stops following for 5 seconds; the mini player shows
   "Resume follow". Press it to jump back.
3. Alt+click any word: reading jumps there. Select a phrase: a "Play from here" button appears.
4. On the page: Space, J/K, Shift+J/K, − and =, F and Esc work while a session is active.
5. Side panel: click a sentence in the Reader tab to jump; use the Outline tab; the footer says
   "On-device · Kokoro · WebGPU".
6. Try a dark-themed site: the highlight inverts to stay readable.
7. Reload the page and read it again: it resumes where you left off.

### M7

1. Options → Voices & models: install "Classic (lessac high)"; the personal-use notice appears first.
2. Set it as default and read an article: you hear the Classic voice; the highlight follows
   estimated timings (watch for words lagging by more than a beat).
3. System voices: pick a local voice as default and read a page; turn Strict offline off to see
   online voices labelled "Online".
4. Optional: `pnpm build:test && pnpm models:fetch all && pnpm synth:corpus`, then open
   `quality/out/<run>/index.html` and `pnpm quality quality/out/<run>`.

### M6

1. `pnpm build`, remove and re-add the unpacked extension: onboarding opens.
2. Get started → Download: watch the progress (326 MB with WebGPU, 92 MB without); try Pause and
   Resume. Continue unlocks when it says "Downloaded and verified".
3. Run the check: it shows something like "Kokoro · WebGPU · 9× real time".
4. Voice: press Sample on each voice; pick one.
5. Open an article, right-click → Read page from here: you now hear Kokoro (the side panel UI is
   still mock data until M8).
6. Options → Voices & models: Repair and Remove work; Remove then Play shows an error that points
   back here.
7. Turn off Wi-Fi and read another page: it still works.

### M5

The voice is still the TestEngine tone (real voices arrive in M6/M7), so you hear a quiet beep
per word.

1. `pnpm build`, reload the unpacked extension.
2. Open any article, right-click the page → **Read page from here**: the side panel opens and a
   tone starts (the side panel UI is still mock data until M8).
3. Press Alt+Shift+P: playback pauses; press again: it resumes.
4. Alt+Shift+Period / Alt+Shift+Comma: next / previous sentence (tone restarts).
5. Select a paragraph, right-click → **Read selection aloud**: only that text is read.
6. Pause, wait a minute, press Alt+Shift+P: playback resumes where it stopped.

### M2

1. `pnpm build`, reload the unpacked extension, click the toolbar icon: the side panel shows the
   transport, Reader / Outline / Settings tabs and the engine footer (mock data).
2. Press Space, then J/K, − and =: playback, sentence and speed change; the word cursor glides.
3. Settings tab → Theme → Dark: the panel turns dark; open the options page (right-click the icon →
   Options): it is dark too.
4. Resize the side panel between its narrowest and widest: nothing overflows.
5. Open `chrome-extension://<id>/reader.html` and `onboarding.html` and tab through every control.

### M1 (optional listening)

1. After `pnpm spikes:run kokoro piper`, play the WAVs in `spikes/out/` (Kokoro `af_heart`, Piper lessac high/medium).

### M0

1. `pnpm build`, then load `.output/chrome-mv3` unpacked in Chrome.
2. Click the toolbar icon: the side panel opens and shows "Open Reader".
3. Open `chrome://extensions/shortcuts`: four Open Reader shortcuts are listed.
