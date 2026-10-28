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

## Text pipeline (M3)

`src/core/document`: the §5.1 model (`model.ts`), block building (`build.ts`), anchor lookups
(`anchors.ts`) and the `Navigator` over readable sentences (`positions.ts`).

`src/core/text`: `segment.ts` (Intl.Segmenter + repairs), `normalize.ts` (rules and pipeline),
`offsetMap.ts` (per-character maps), `lexicon.ts` (packs), `skip.ts` (reading rules, zod schema),
`pacing.ts` (structural pauses) and `segments.ts` (`SpokenSegment`s with maps and pauses).

```text
Block.text ──segment──▶ Sentence ──normalize──▶ spoken + OffsetMap ──split──▶ SpokenSegment[]
                                                     ▲ engine word timings use spoken offsets
```
