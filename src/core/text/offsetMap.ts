/**
 * Per-character offset maps from spoken text back to display text.
 *
 * For every spoken character i, [start[i], end[i]) is the display range it came from. Copied
 * characters map 1:1; every character of a replacement maps to the whole replaced range (so "for
 * example" highlights all of "e.g."); inserted characters map to an empty range at a position.
 * Maps compose, so a pipeline of rules still maps every spoken word to its source.
 */
export interface OffsetMap {
  readonly start: Int32Array;
  readonly end: Int32Array;
  /** Length of the source (display) text. */
  readonly sourceLength: number;
}

export interface Rewrite {
  spoken: string;
  map: OffsetMap;
}

export function identityMap(length: number): OffsetMap {
  const start = new Int32Array(length);
  const end = new Int32Array(length);
  for (let i = 0; i < length; i++) {
    start[i] = i;
    end[i] = i + 1;
  }
  return { start, end, sourceLength: length };
}

/** Builds a rewrite of `source` left to right. */
export class RewriteBuilder {
  private out = '';
  private readonly s: number[] = [];
  private readonly e: number[] = [];
  private cursor = 0;

  constructor(private readonly source: string) {}

  /** Copies source[cursor, to) verbatim. */
  copyTo(to: number): this {
    for (let i = this.cursor; i < to; i++) {
      this.out += this.source[i];
      this.s.push(i);
      this.e.push(i + 1);
    }
    this.cursor = Math.max(this.cursor, to);
    return this;
  }

  /** Replaces source[from, to) with `text` (copying anything before `from` first). */
  replace(from: number, to: number, text: string): this {
    this.copyTo(from);
    for (const ch of text) {
      for (let k = 0; k < ch.length; k++) {
        this.out += ch[k];
        this.s.push(from);
        this.e.push(to);
      }
    }
    this.cursor = Math.max(this.cursor, to);
    return this;
  }

  /** Inserts `text` at `at` without consuming source; it maps to the empty range [at, at). */
  insert(at: number, text: string): this {
    this.copyTo(at);
    for (let k = 0; k < text.length; k++) {
      this.out += text[k];
      this.s.push(at);
      this.e.push(at);
    }
    return this;
  }

  finish(): Rewrite {
    this.copyTo(this.source.length);
    return {
      spoken: this.out,
      map: {
        start: Int32Array.from(this.s),
        end: Int32Array.from(this.e),
        sourceLength: this.source.length,
      },
    };
  }
}

/** Maps a spoken range back to the display range it covers. Empty spoken ranges map to a point. */
export function mapRange(map: OffsetMap, spokenStart: number, spokenEnd: number): [number, number] {
  const n = map.start.length;
  if (n === 0) return [0, 0];
  const a = Math.max(0, Math.min(spokenStart, n));
  const b = Math.max(a, Math.min(spokenEnd, n));
  if (a === b) {
    const p = a < n ? (map.start[a] ?? 0) : (map.end[n - 1] ?? map.sourceLength);
    return [p, p];
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = a; i < b; i++) {
    const s = map.start[i] ?? 0;
    const e = map.end[i] ?? 0;
    if (s < lo) lo = s;
    if (e > hi) hi = e;
  }
  return [lo, Math.max(lo, hi)];
}

/**
 * Composes `outer` (text2 → text1) with `inner` (text1 → text0) into text2 → text0.
 * A char copied or replaced from a text1 range takes the union of that range's text0 ranges.
 */
export function composeMaps(outer: OffsetMap, inner: OffsetMap): OffsetMap {
  const n = outer.start.length;
  const start = new Int32Array(n);
  const end = new Int32Array(n);
  for (let i = 0; i < n; i++) {
    const [s, e] = mapRange(inner, outer.start[i] ?? 0, outer.end[i] ?? 0);
    start[i] = s;
    end[i] = e;
  }
  return { start, end, sourceLength: inner.sourceLength };
}

/** Applies rules in order, composing their maps. */
export function pipeline(text: string, rules: ((t: string) => Rewrite)[]): Rewrite {
  let current: Rewrite = { spoken: text, map: identityMap(text.length) };
  for (const rule of rules) {
    const next = rule(current.spoken);
    current = { spoken: next.spoken, map: composeMaps(next.map, current.map) };
  }
  return current;
}

/** Rewrites every regex match with `replacer`; returning null leaves the match untouched. */
export function rewriteMatches(
  text: string,
  re: RegExp,
  replacer: (m: RegExpExecArray, b: RewriteBuilder) => unknown,
): Rewrite {
  const b = new RewriteBuilder(text);
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  for (let m = g.exec(text); m; m = g.exec(text)) {
    if (m[0].length === 0) {
      g.lastIndex++;
      continue;
    }
    replacer(m, b);
  }
  return b.finish();
}
