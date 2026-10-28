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
