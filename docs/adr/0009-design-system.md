# 0009: Design system implementation choices (M2)

## Context

M2 built the §3 tokens, fonts, components and shells with the `frontend-design` and `minimalist-ui`
skills, then reviewed them with `web-design-guidelines` and `accessibility`. Some skill rules
conflict with the brief or with each other.

## Decisions

- **Theme mechanics.** Light tokens on `:root`; dark tokens apply under
  `prefers-color-scheme: dark` unless `data-theme="light"`, and always under `data-theme="dark"`.
  The preference (`system | light | dark`, plus `motion: system | reduce`) lives in
  `chrome.storage.local` and syncs across open extension pages through `storage.onChanged`.
- **Inversion, not a fixed black.** Surfaces that the brief calls "black" (floating transport, play
  button, primary buttons) use `--ink`, so they become off-white pills in dark mode. This keeps one
  rule ("ink on paper") and the same contrast in both themes.
- **Sentence case.** `frontend-design` and PLAN.md ask for plain sentence-case labels; the Web
  Interface Guidelines ask for Title Case. The brief wins: sentence case everywhere.
- **Compositor-only motion.** The reading cursor moves and resizes with one
  `translate() scaleX()` transform (120 ms); progress bars use `scaleX`. Durations come from
  `--dur`/`--dur-cursor`, which drop to 0 under reduced motion.
- **Target size.** Switches are 24 px tall and slider thumbs have a 24 px hit area (WCAG 2.2 2.5.8).
- **State without colour.** Toggles print On/Off; the engine status glyph changes shape by state;
  error toasts start with a bold "Error:" label and an icon.
- **Mini player.** Lives in a closed shadow root with self-contained CSS (tokens on `:host`) and no
  Radix portals, which would escape the shadow root. Self-hosted fonts must be registered at
  document level from the content script (M8) because `@font-face` inside a shadow root is ignored.
- **Reader view clicks.** Sentences are clickable through one delegated listener; keyboard users
  seek with J/K and the outline instead of hundreds of focusable spans.
- **Component gallery.** `gallery.html` holds every component for axe, keyboard and screenshot
  tests. A `entrypoints:resolved` hook drops it from production builds.
- **Screenshot baselines** are stored per platform (`tests/e2e/__screenshots__/<platform>/`). CI on
  Linux records its own baselines on first run (`updateSnapshots: 'missing'`).

## Consequences

Visual changes require regenerating baselines deliberately:
`rm -rf tests/e2e/__screenshots__/darwin && pnpm exec playwright test tests/e2e/ui.spec.ts --update-snapshots=missing`.
