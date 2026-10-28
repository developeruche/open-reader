# Progress

## Milestones

- [x] M0: Bootstrap, tooling and skills
- [ ] M1: Feasibility spikes and ADRs
- [ ] M2: Design system and app shells
- [ ] M3: Document model and text pipeline
- [ ] M4: Audio pipeline and player core
- [ ] M5: Extension runtime, hosts and messaging
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

- None yet.

## Manual QA scripts

### M0

1. `pnpm build`, then load `.output/chrome-mv3` unpacked in Chrome.
2. Click the toolbar icon: the side panel opens and shows "Open Reader".
3. Open `chrome://extensions/shortcuts`: four Open Reader shortcuts are listed.
