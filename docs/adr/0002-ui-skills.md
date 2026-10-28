# 0002: How the UI/UX skills are installed

## Context

The plan installs four skills with `npx skills add`. Reading the sources first showed:

- `minimalist-ui` was moved out of `leonxlnx/taste-skill` into `Leonxlnx/taste-skill-classics`
  (folder `skills/minimalist-skill`, install name still `minimalist-ui`) on 2026-10-19. It is now
  opt-in (`disable-model-invocation: true`): it loads only when called by name.
- `web-design-guidelines` fetches its rules from a GitHub URL at every run, so its behaviour can
  change without review.
- None of the four skills bundles scripts; all are design or accessibility guidance.

## Decision

Copy each skill folder from a pinned commit into `.claude/skills/` instead of running a
third-party installer. Vendor a pinned copy of the web interface guidelines as
`guidelines.md` and point the skill at it. Commits are listed in `docs/PROGRESS.md`.

The brand rules in PLAN.md §3 override every skill. In particular, from `minimalist-ui` we ignore
the pastel accents, the `#EAEAEA` border rule, the Lucide ban (we use Lucide at 1.5px stroke),
ambient gradients and scroll-entry animations.

## Alternatives

- `npx skills add`: runs an unreviewed CLI and, for `web-design-guidelines`, still fetches rules
  at runtime.
- Use `taste-skill` v2 (`design-taste-frontend`) instead of `minimalist-ui`: it ships browser
  automation scripts and CDN assets, which is beyond design guidance.

## Consequences

Updating a skill is a deliberate copy from a newer commit, recorded in `docs/PROGRESS.md`.
