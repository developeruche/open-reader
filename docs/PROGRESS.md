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
- [ ] M9: Document mode (PDF), end to end
- [ ] M10: Reliability, performance and diagnostics hardening
- [ ] M11: Power features
- [ ] M12: Online voices (opt-in)
- [ ] M13: OCR for scanned PDFs (optional)
- [ ] M14: Polish, audits and v1.0.0

## Decisions

| ADR                                    | Decision                                                                                                     |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| [0001](adr/0001-toolchain-versions.md) | TypeScript 6.0 and ESLint 9 (newest typescript-eslint and jsx-a11y support)                                  |
| [0002](adr/0002-ui-skills.md)          | UI skills vendored at project scope from pinned commits; `minimalist-ui` now lives in `taste-skill-classics` |

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

- The content script is ~580 kB because the mini player uses React; consider a vanilla mini player in M10 if injection time matters.
- "Read page from here" before the first injection starts at the first visible block, not the exact right-click point.

- ASR heard "Schnorr" (respelled "shnor") as "snore"; confirm by ear (ADR 0014).
- The owner's own articles are not yet in `tests/fixtures/corpus/owner/`; the harness uses project-written passages.

- HeadTTS's G2P reads a standalone spelled letter "A" (in acronyms such as "A P I") as "uh". Most
  acronyms are unaffected; revisit with the M7 quality harness.
- The runtime "voice is too slow" suggestion (§6.4.4) has its monitor (`RtfMonitor`) but is wired
  into the player in M10.

- Speed above 2× (model speed 1.25 + slower playback) still needs the listening test planned for M7.

- Reader view renders every block; for very long pages consider `content-visibility: auto` or
  virtualization in M8 after measuring (Web Interface Guidelines: lists > 50 items).

- Kokoro fp16 on WebGPU outputs silence on Apple M3 Max (ADR 0003). The benchmark must reject silent output.
- `navigator.storage.persist()` returns false in a fresh profile; show it on the Storage page (ADR 0008).

## Spikes (M1)

Throwaway code under `spikes/` (excluded from build, lint and typecheck). Reproduce with
`pnpm spikes:setup && pnpm spikes:build && pnpm spikes:run`; results land in `spikes/out/` (gitignored).

## Manual QA scripts

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
