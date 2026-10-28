/** Sentence and word segmentation (PLAN.md §5.2.1): Intl.Segmenter plus repairs for its known misses. */

export interface Span {
  start: number;
  end: number;
}

/**
 * Abbreviations that almost never end a sentence, so a break after them is false even when the
 * next word is capitalized ("Dr. Smith", "Fig. 3", "St. Louis"). Case-sensitive.
 */
const NEVER_FINAL = new Set([
  'Dr',
  'Mr',
  'Mrs',
  'Ms',
  'Mx',
  'Prof',
  'Sr',
  'St',
  'Mt',
  'Rev',
  'Gen',
  'Col',
  'Capt',
  'Lt',
  'Sgt',
  'Hon',
  'Fig',
  'Figs',
  'Eq',
  'Eqs',
  'Ref',
  'Refs',
  'No',
  'Nos',
  'Vol',
  'Vols',
  'Ch',
  'Sec',
  'Art',
  'Ex',
  'vs',
  'cf',
  'approx',
  'ca',
  'e.g',
  'i.e',
  'viz',
  'pp',
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Sept',
  'Oct',
  'Nov',
  'Dec',
]);

/** Words that usually start a new sentence; used to keep "Plan B. Then…" split. */
const SENTENCE_STARTERS = new Set([
  'The',
  'A',
  'An',
  'It',
  'Its',
  'This',
  'That',
  'These',
  'Those',
  'We',
  'I',
  'He',
  'She',
  'They',
  'You',
  'In',
  'On',
  'At',
  'But',
  'And',
  'So',
  'Then',
  'There',
  'When',
  'What',
  'If',
  'As',
  'For',
  'However',
  'Now',
  'Next',
  'Finally',
  'First',
  'Second',
  'Also',
  'Each',
  'Our',
  'My',
  'Your',
]);

const sentenceSegmenter = new Intl.Segmenter('en', { granularity: 'sentence' });
const wordSegmenter = new Intl.Segmenter('en', { granularity: 'word' });

function lastToken(s: string): string {
  const m = /(\S+)\s*$/.exec(s);
  return m?.[1] ?? '';
}

function firstWord(s: string): string {
  const m = /^\s*["“'‘(]*([\p{L}\p{N}]+)/u.exec(s);
  return m?.[1] ?? '';
}

/** True if the boundary between `prev` and `next` is a false sentence break. */
export function isFalseBreak(prev: string, next: string): boolean {
  const tok = lastToken(prev);
  if (!tok.endsWith('.')) return false;
  const bare = tok.slice(0, -1).replace(/^["“'‘(]+/, '');
  if (NEVER_FINAL.has(bare)) return true;
  const nextWord = firstWord(next);
  // Lone initial ("J.") or a run of initials, followed by a name.
  if (/^\p{Lu}$/u.test(bare) && /^\p{Lu}/u.test(nextWord) && !SENTENCE_STARTERS.has(nextWord)) {
    const before = prev.trimEnd().slice(0, -tok.length).trimEnd();
    const prevTok = lastToken(before);
    if (before === '' || /^\p{Lu}\.$/u.test(prevTok) || /^\p{Lu}[\p{Ll}'’-]+$/u.test(prevTok))
      return true;
  }
  return false;
}

/** Splits `text` into trimmed sentence spans. */
export function segmentSentences(text: string): Span[] {
  const raw = [...sentenceSegmenter.segment(text)].map((s) => ({
    start: s.index,
    end: s.index + s.segment.length,
  }));
  const merged: Span[] = [];
  for (const r of raw) {
    const prev = merged.at(-1);
    if (prev && isFalseBreak(text.slice(prev.start, prev.end), text.slice(r.start, r.end)))
      prev.end = r.end;
    else merged.push({ ...r });
  }
  const out: Span[] = [];
  for (const m of merged) {
    let { start, end } = m;
    while (start < end && /\s/.test(text[start] ?? '')) start++;
    while (end > start && /\s/.test(text[end - 1] ?? '')) end--;
    if (end > start) out.push({ start, end });
  }
  return out;
}

/** Word-like spans within text[from, to), as absolute offsets. */
export function segmentWords(text: string, from = 0, to = text.length): Span[] {
  const slice = text.slice(from, to);
  const out: Span[] = [];
  for (const s of wordSegmenter.segment(slice)) {
    if (s.isWordLike) out.push({ start: from + s.index, end: from + s.index + s.segment.length });
  }
  return out;
}

/**
 * Clause boundaries inside text[from, to): offsets just after ", ; : — –" followed by a space.
 * Used to split long sentences and to start audio sooner (§5.2.6).
 */
export function clauseBoundaries(text: string, from = 0, to = text.length): number[] {
  const out: number[] = [];
  const re = /[,;:—–](?=\s)/g;
  const slice = text.slice(from, to);
  for (let m = re.exec(slice); m; m = re.exec(slice)) out.push(from + m.index + 1);
  return out;
}
