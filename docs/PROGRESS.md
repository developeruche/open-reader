# Progress

## Milestones

- [x] M0: Bootstrap, tooling and skills
- [x] M1: Feasibility spikes and ADRs
- [x] M2: Design system and app shells
- [x] M3: Document model and text pipeline
- [x] M4: Audio pipeline and player core
- [x] M5: Extension runtime, hosts and messaging
- [ ] M6: Model manager and the default engine (Kokoro)
- [ ] M7: Piper, system voices and the voice bake-off
- [ ] M8: Web mode, end to end
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

- Speed above 2× (model speed 1.25 + slower playback) still needs the listening test planned for M7.

- Reader view renders every block; for very long pages consider `content-visibility: auto` or
  virtualization in M8 after measuring (Web Interface Guidelines: lists > 50 items).

- Kokoro fp16 on WebGPU outputs silence on Apple M3 Max (ADR 0003). The benchmark must reject silent output.
- `navigator.storage.persist()` returns false in a fresh profile; show it on the Storage page (ADR 0008).

## Spikes (M1)

Throwaway code under `spikes/` (excluded from build, lint and typecheck). Reproduce with
`pnpm spikes:setup && pnpm spikes:build && pnpm spikes:run`; results land in `spikes/out/` (gitignored).

## Manual QA scripts

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
