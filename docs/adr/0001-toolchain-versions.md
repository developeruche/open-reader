# 0001: Toolchain versions (TypeScript 6.0, ESLint 9)

## Context

The plan asks for the newest TypeScript that WXT, Vitest and typescript-eslint support together.
In October 2026 TypeScript 7.0 (the native compiler) is current, but typescript-eslint 8.72 declares
`typescript >=4.8.4 <6.1.0`. ESLint 10 is current, but `eslint-plugin-jsx-a11y` 6.10.2 declares
peer support only up to ESLint 9.

## Decision

Pin TypeScript 6.0.3 and ESLint 9.39.5. All other tools use their latest stable versions
(WXT 0.21.5 on Vite 8, Vitest 5.0.5, Playwright 1.64.1, React 19.3, Tailwind 4.3).

## Alternatives

- TypeScript 7 with typescript-eslint unsupported: type-aware lint rules could break silently.
- ESLint 10 without jsx-a11y: loses the accessibility lint the plan requires.

## Consequences

Revisit when typescript-eslint and jsx-a11y widen their peer ranges. Typecheck uses `tsc --noEmit`.
