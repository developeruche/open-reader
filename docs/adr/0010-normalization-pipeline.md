# 0010: Normalization pipeline and offset maps (M3)

## Context

§5.2.3 asks for pure rules returning `{ spoken, map }` so engine word timings (in spoken offsets)
land on the original words. M3 implemented the pipeline and found three ordering problems with the
plan's rule order, plus a model gap for inline code.

## Decisions

- **Per-character offset maps.** Each spoken character stores the display range it came from
  (`Int32Array` start/end). Copies map 1:1, every character of a replacement maps to the whole
  replaced range ("for example" → all of "e.g."; "P S B T" → all of "PSBT"), insertions map to an
  empty range. Composition is a per-character union, so any pipeline keeps exact provenance.
  Sentences are short, so O(n) memory per sentence is negligible.
- **Rule order** (changes from §5.2.3 in bold):
  1. inline code identifiers (needs display offsets of the marks);
  2. **inline skips** (citations, footnote markers, URLs) **before NFKC**, because NFKC turns "¹" into "1";
  3. NFKC;
  4. symbols; 5. abbreviations; 6. snake_case and **CONSTANT_CASE** splitting;
  5. **numbers, then units, before acronyms**, so "5 MB" becomes "5 megabytes", not "5 M B", and
     "3–5 ms" becomes "3 to 5 milliseconds";
  6. acronyms (skipping lexicon keys, Roman numerals, a speakable list and all-caps headings);
  7. lexicon (user → domain packs → built-ins; engine-specific entries);
  8. whitespace cleanup.
- **Inline marks.** `Block.marks?: { start, end, kind: 'code' | 'link' }[]` extends §5.1 so inline
  code can split `camelCase` without touching prose like "iPhone".
- **Citations** match `[1]`, `[3–5]`, `[a]`, `[note 2]`, `[citation needed]`, but not `[0]`
  (array indexing in prose is more common than citation zero).
- **Long hex** (> 16 digits, or 32+ hex chars such as txids) reads as "a long hex string".
- **Skipped code announcement** is a synthetic segment ("Code block skipped.") mapped to the whole
  code block, enabled through `Navigator({ announceSkippedCode })`.
- `NORMALIZER_VERSION = 1` is part of the synthesis cache key; bump it on any output change.

## Consequences

335 golden cases and fast-check properties (every spoken word maps to a non-empty, in-bounds,
monotonic display range) guard the pipeline. New rules must keep both suites green.
