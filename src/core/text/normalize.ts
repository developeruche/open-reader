/**
 * Display text → spoken text (PLAN.md §5.2.3). Every rule is a pure function returning
 * `{ spoken, map }`; maps compose so each spoken word maps back to its display range.
 */
import type { InlineMark } from '../document/model';
import { Lexicon } from './lexicon';
import { ordinal } from './numbers';
import { identityMap, pipeline, rewriteMatches, RewriteBuilder, type Rewrite } from './offsetMap';

/** Bump when normalization output changes; it is part of the synthesis cache key. */
export const NORMALIZER_VERSION = 1;

export interface InlineSkipOptions {
  citations: boolean;
  footnoteMarkers: boolean;
  /** 'skip' drops bare URLs; 'say' reads "link to example dot com". */
  urls: 'skip' | 'say';
}

export const DEFAULT_INLINE_SKIPS: InlineSkipOptions = {
  citations: true,
  footnoteMarkers: true,
  urls: 'skip',
};

export interface NormalizeOptions {
  lexicon?: Lexicon;
  skips?: InlineSkipOptions;
  marks?: InlineMark[];
}

type Rule = (text: string) => Rewrite;

/** Splits identifiers inside inline code: camelCase → "camel case", snake_case → "snake case". */
export function inlineCodeRule(marks: InlineMark[] = []): Rule {
  return (text) => {
    const b = new RewriteBuilder(text);
    for (const m of [...marks].filter((x) => x.kind === 'code').sort((x, y) => x.start - y.start)) {
      const slice = text.slice(m.start, m.end);
      const re = /[A-Za-z][A-Za-z0-9]*(?:_[A-Za-z0-9]+)*|\(\)|[._]/g;
      for (let x = re.exec(slice); x; x = re.exec(slice)) {
        const s = m.start + x.index;
        const e = s + x[0].length;
        if (x[0] === '()') b.replace(s, e, '');
        else if (x[0] === '.') b.replace(s, e, ' dot ');
        else if (x[0] === '_') b.replace(s, e, ' ');
        else {
          const words = x[0]
            .replace(/_/g, ' ')
            .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
            .split(' ')
            // All-caps parts stay as written so acronym and lexicon rules still see them.
            .map((w) => (/^[A-Z0-9]{2,}$/.test(w) ? w : w.toLowerCase()))
            .join(' ');
          if (words !== x[0]) b.replace(s, e, words);
        }
      }
    }
    return b.finish();
  };
}

/** Unicode NFKC per character (ligatures "ﬁ" → "fi", full-width forms), keeping the map. */
export const nfkcRule: Rule = (text) => {
  const b = new RewriteBuilder(text);
  let i = 0;
  for (const ch of text) {
    const n = ch.normalize('NFKC');
    if (n !== ch) b.replace(i, i + ch.length, n);
    i += ch.length;
  }
  return b.finish();
};

export function inlineSkipRule(o: InlineSkipOptions): Rule {
  return (text) => {
    const parts: string[] = [];
    if (o.citations)
      parts.push(
        String.raw`\[(?:[1-9]\d*(?:\s*[–,-]\s*\d+)*|[a-z]|note \d+|citation needed|clarification needed)\]`,
      );
    if (o.footnoteMarkers) parts.push('[¹²³⁴⁵⁶⁷⁸⁹⁰]+', '[†‡]');
    parts.push(String.raw`\b(?:https?://|www\.)[^\s<>"]+[^\s<>".,;:!?)\]]`);
    const re = new RegExp(parts.join('|'), 'g');
    return rewriteMatches(text, re, (m, b) => {
      const s = m.index;
      const e = s + m[0].length;
      if (/^(?:https?:|www\.)/.test(m[0])) {
        if (o.urls === 'skip') b.replace(s, e, '');
        else {
          const host =
            m[0]
              .replace(/^https?:\/\//, '')
              .replace(/^www\./, '')
              .split(/[/?#]/)[0] ?? '';
          b.replace(s, e, `link to ${host.replace(/\./g, ' dot ')}`);
        }
      } else b.replace(s, e, '');
    });
  };
}

const SYMBOLS: Record<string, string> = {
  '‖': 'followed by',
  '≥': 'at least',
  '≤': 'at most',
  '→': 'to',
  '×': 'times',
  '&': 'and',
  '%': 'percent',
  '±': 'plus or minus',
  '≈': 'about',
  '≠': 'not equal to',
};

export const symbolRule: Rule = (text) =>
  rewriteMatches(text, /[‖≥≤→×&%±≈≠]|~(?=\s?\d)/g, (m, b) => {
    const s = m.index;
    const word = m[0] === '~' ? 'about' : (SYMBOLS[m[0]] ?? m[0]);
    const before = text[s - 1] ?? ' ';
    const after = text[s + 1] ?? ' ';
    const pre = /\s/.test(before) || s === 0 ? '' : ' ';
    const post = /\s/.test(after) || s + 1 === text.length ? '' : ' ';
    b.replace(s, s + 1, `${pre}${word}${post}`);
  });

const ABBREVIATIONS: [RegExp, string][] = [
  [/\be\.g\.,?/g, 'for example,'],
  [/\bi\.e\.,?/g, 'that is,'],
  [/\betc\.(?=,|\s|$)/g, 'and so on'],
  [/\bvs\.?(?=\s)/g, 'versus'],
  [/\bet al\./g, 'and others'],
  [/\bcf\./g, 'compare'],
  [/\bapprox\./g, 'approximately'],
  [/\bDr\.(?=\s)/g, 'Doctor'],
  [/\bMr\.(?=\s)/g, 'Mister'],
  [/\bMrs\.(?=\s)/g, 'Missus'],
  [/\bProf\.(?=\s)/g, 'Professor'],
  [/\bFigs\.(?=\s)/g, 'Figures'],
  [/\bFig\.(?=\s)/g, 'Figure'],
  [/\bEqs?\.(?=\s)/g, 'Equation'],
  [/\bNo\.(?=\s?\d)/g, 'number'],
  [/\bVol\.(?=\s?\d)/g, 'volume'],
  [/\bpp\.(?=\s?\d)/g, 'pages'],
  [/\bp\.(?=\s?\d)/g, 'page'],
  [/\bca\.(?=\s?\d)/g, 'circa'],
  [/\bSept?\.(?=\s)/g, 'September'],
];

export const abbreviationRule: Rule = (text) => {
  const all = new RegExp(ABBREVIATIONS.map(([re]) => `(${re.source})`).join('|'), 'g');
  return rewriteMatches(text, all, (m, b) => {
    const k = m.slice(1).findIndex((g) => g !== undefined);
    let say = ABBREVIATIONS[k]?.[1] ?? m[0];
    // "e.g." without a following comma reads without one.
    if (say.endsWith(',') && !m[0].endsWith(',')) say = say.slice(0, -1);
    // Keep a sentence-final period: "…and so on."
    const end = m.index + m[0].length;
    if (m[0].endsWith('.') && end === text.length) say += '.';
    b.replace(m.index, end, say);
  });
};

/** Acronyms read as words; everything else of 2–6 capitals/digits is spelled out. */
export const SPEAKABLE = new Set([
  'NASA',
  'NATO',
  'JSON',
  'UNESCO',
  'UNICEF',
  'FIFA',
  'NIST',
  'ASCII',
  'JPEG',
  'LASER',
  'RADAR',
  'SCUBA',
  'OPEC',
  'RAM',
  'ROM',
  'PIN',
  'CAPTCHA',
  'IKEA',
  'AIDS',
  'COVID',
  'GIF',
  'SWIFT',
  'DARPA',
  'POSIX',
  'CRUD',
  'REST',
  'SOAP',
  'WYSIWYG',
  'NIMBY',
  'FOMO',
  'YOLO',
  'FAQ',
  'ISIS',
  'SIM',
  'DAO',
  'NAT',
  'LAN',
  'WAN',
  'SaaS',
  'TOEFL',
  'SATA',
  'PEP',
]);

const ROMAN = /^(?=[MDCLXVI]{2,})M{0,3}(CM|CD|D?C{0,3})(XC|XL|L?X{0,3})(IX|IV|V?I{0,3})$/;

function spellToken(core: string): string {
  return (core.match(/[A-Z]|\d+/g) ?? []).join(' ');
}

export function acronymRule(lexicon?: Lexicon): Rule {
  return (text) => {
    const caps = text.match(/\b[A-Z]{2,}\b/g) ?? [];
    const words = text.match(/\b[A-Za-z]{2,}\b/g) ?? [];
    // Shouting or an all-caps heading: don't spell ordinary words.
    if (caps.length >= 3 && caps.length / Math.max(words.length, 1) > 0.6)
      return { spoken: text, map: identityMap(text.length) };
    return rewriteMatches(
      text,
      /(?<![\p{L}\p{N}_-])([A-Z][A-Z0-9]{1,5})(s|['’]s)?(?![\p{L}\p{N}_])/gu,
      (m, b) => {
        const core = m[1] ?? '';
        if ((core.match(/[A-Z]/g) ?? []).length < 2 && !/\d/.test(core)) return;
        if (SPEAKABLE.has(core) || ROMAN.test(core) || lexicon?.has(m[0])) return;
        const suffix = m[2] ? "'s" : '';
        b.replace(m.index, m.index + m[0].length, spellToken(core) + suffix);
      },
    );
  };
}

const UNITS: [string, string, string][] = [
  // [unit, singular, plural]
  ['sat/vB', 'sat per virtual byte', 'sats per virtual byte'],
  ['sats/vB', 'sat per virtual byte', 'sats per virtual byte'],
  ['sat/vbyte', 'sat per virtual byte', 'sats per virtual byte'],
  ['kvB', 'kilo virtual byte', 'kilo virtual bytes'],
  ['vB', 'virtual byte', 'virtual bytes'],
  ['vbytes', 'virtual byte', 'virtual bytes'],
  ['WU', 'weight unit', 'weight units'],
  ['BTC', 'bitcoin', 'bitcoin'],
  ['ms', 'millisecond', 'milliseconds'],
  ['µs', 'microsecond', 'microseconds'],
  ['μs', 'microsecond', 'microseconds'], // NFKC turns the micro sign into Greek mu
  ['ns', 'nanosecond', 'nanoseconds'],
  ['KiB', 'kibibyte', 'kibibytes'],
  ['MiB', 'mebibyte', 'mebibytes'],
  ['GiB', 'gibibyte', 'gibibytes'],
  ['kB', 'kilobyte', 'kilobytes'],
  ['KB', 'kilobyte', 'kilobytes'],
  ['MB', 'megabyte', 'megabytes'],
  ['GB', 'gigabyte', 'gigabytes'],
  ['TB', 'terabyte', 'terabytes'],
  ['GHz', 'gigahertz', 'gigahertz'],
  ['MHz', 'megahertz', 'megahertz'],
  ['kHz', 'kilohertz', 'kilohertz'],
  ['Hz', 'hertz', 'hertz'],
  ['km', 'kilometer', 'kilometers'],
  ['kg', 'kilogram', 'kilograms'],
  ['mm', 'millimeter', 'millimeters'],
  ['cm', 'centimeter', 'centimeters'],
];

const unitAlt = UNITS.map(([u]) => u.replace(/[/.]/g, (c) => `\\${c}`)).join('|');

export const numberRule: Rule = (text) => {
  const re = new RegExp(
    [
      String.raw`\b0x([0-9a-fA-F]+)\b`, // 1 hex
      String.raw`\b[0-9a-f]{32,}\b`, // long hashes
      String.raw`\bv(\d+(?:\.\d+)*)\b`, // 2 versions
      String.raw`(?<![\d.-])(\d{1,4})\s?[–—]\s?(\d{1,4})(?![\d-])|(?<![\d.-])(\d{1,4})-(\d{1,4})(?![\d-])`, // 3,4 / 5,6 ranges
      String.raw`\b(\d+)(st|nd|rd|th)\b`, // 7,8 ordinals
      String.raw`([$€£])(\d+(?:[.,]\d+)*)`, // 9,10 currency
    ].join('|'),
    'gu',
  );
  return rewriteMatches(text, re, (m, b) => {
    const s = m.index;
    const e = s + m[0].length;
    const g = (i: number) => m[i];
    if (g(1) !== undefined) {
      const digits = g(1) ?? '';
      b.replace(
        s,
        e,
        digits.length > 16
          ? 'a long hex string'
          : `hex ${digits.toUpperCase().split('').join(' ')}`,
      );
    } else if (/^[0-9a-f]{32,}$/.test(m[0])) {
      b.replace(s, e, 'a long hex string');
    } else if (g(2) !== undefined) {
      b.replace(s, e, `version ${g(2)}`);
    } else if (g(3) !== undefined || g(5) !== undefined) {
      const a = g(3) ?? g(5);
      const z = g(4) ?? g(6);
      b.replace(s, e, `${a} to ${z}`);
    } else if (g(7) !== undefined) {
      const n = Number(g(7));
      if (n <= 999_999) b.replace(s, e, ordinal(n));
    } else if (g(9) !== undefined) {
      const amount = g(10) ?? '';
      const one = Number(amount.replace(/,/g, '')) === 1;
      const name = { $: 'dollar', '€': 'euro', '£': 'pound' }[g(9) as '$' | '€' | '£'];
      b.replace(s, e, `${amount} ${name}${one ? '' : 's'}`);
    }
  });
};

/** Units after numbers ("5 ms" → "5 milliseconds"), after ranges have become "3 to 5". */
export const unitRule: Rule = (text) => {
  const re = new RegExp(
    String.raw`(\d+(?:[.,]\d+)*)\s?(${unitAlt})(?![\p{L}\p{N}])|(?<![\p{L}\p{N}])(sats?/vB)(?![\p{L}\p{N}])`,
    'gu',
  );
  return rewriteMatches(text, re, (m, b) => {
    const s = m.index;
    const e = s + m[0].length;
    if (m[3] !== undefined) return b.replace(s, e, 'sats per virtual byte');
    const num = m[1] ?? '';
    const unit = UNITS.find(([u]) => u === m[2]);
    if (!unit) return;
    const one = Number(num.replace(/,/g, '')) === 1;
    b.replace(s, e, `${num} ${one ? unit[1] : unit[2]}`);
  });
};

/** CONSTANT_CASE reads as words: parts the lexicon knows keep their case, the rest are lowercased. */
export function constantCaseRule(lexicon?: Lexicon): Rule {
  return (text) =>
    rewriteMatches(text, /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\b/g, (m, b) => {
      const words = m[0].split('_').map((w) => (lexicon?.has(w) ? w : w.toLowerCase()));
      b.replace(m.index, m.index + m[0].length, words.join(' '));
    });
}

/** snake_case outside code reads as words. */
export const snakeCaseRule: Rule = (text) =>
  rewriteMatches(text, /\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g, (m, b) =>
    b.replace(m.index, m.index + m[0].length, m[0].replace(/_/g, ' ')),
  );

/** Collapses whitespace, removes spaces before punctuation, trims. */
export const whitespaceRule: Rule = (text) => {
  const b = new RewriteBuilder(text);
  const re = /\s+(?=[,.;:!?])|\s{2,}|\s/g;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const s = m.index;
    const e = s + m[0].length;
    const atEdge = s === 0 || e === text.length;
    const beforePunct = /[,.;:!?]/.test(text[e] ?? '');
    if (atEdge || beforePunct) b.replace(s, e, '');
    else if (m[0] !== ' ') b.replace(s, e, ' ');
  }
  return b.finish();
};

/** The full pipeline in the §5.2.3 order (numbers/units moved before acronyms; see ADR 0010). */
export function normalize(text: string, opts: NormalizeOptions = {}): Rewrite {
  const lexicon = opts.lexicon ?? new Lexicon();
  return pipeline(text, [
    inlineCodeRule(opts.marks),
    // Before NFKC, which would turn footnote markers "¹" into digits.
    inlineSkipRule(opts.skips ?? DEFAULT_INLINE_SKIPS),
    nfkcRule,
    symbolRule,
    abbreviationRule,
    snakeCaseRule,
    constantCaseRule(lexicon),
    // Units before acronyms so "5 MB" reads "5 megabytes", not "5 M B".
    numberRule,
    unitRule,
    acronymRule(lexicon),
    (t) => lexicon.apply(t),
    whitespaceRule,
  ]);
}
