# Architecture

See PLAN.md §4 for the target design. This document is filled in as milestones land.

- `src/entrypoints/`: background, content script, side panel, reader, offscreen, options, onboarding.
- `src/core/`: pure TypeScript (no `chrome.*`), unit-tested.
- `src/platform/`: every `chrome.*` call, behind interfaces.
