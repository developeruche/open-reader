# Third-party software

Every dependency's license is checked by `pnpm licenses:check` (allowlist in
`scripts/check-licenses.ts`). Model licenses are in [MODELS.md](MODELS.md).

## Runtime dependencies (bundled into the extension)

| Package              | Version | License    |
| -------------------- | ------- | ---------- |
| react, react-dom     | 19.3.1  | MIT        |
| pdfjs-dist           | 6.4.299 | Apache-2.0 |
| @mozilla/readability | 0.6.0   | Apache-2.0 |

## Build and test tools

WXT (MIT), Vite (MIT), TypeScript (Apache-2.0), Tailwind CSS (MIT), ESLint (MIT),
typescript-eslint (MIT), Prettier (MIT), Vitest (MIT), Playwright (Apache-2.0), happy-dom (MIT),
lefthook (MIT), tsx (MIT), pdf-lib (MIT, fixtures only), Testing Library (MIT), axe-core / @axe-core/playwright (MPL-2.0), fast-check (MIT), fake-indexeddb (Apache-2.0), @xstate/graph (MIT).

## Design skills (not shipped)

frontend-design (Apache-2.0, see its LICENSE.txt), minimalist-ui (MIT), web-design-guidelines (MIT),
accessibility (MIT).
