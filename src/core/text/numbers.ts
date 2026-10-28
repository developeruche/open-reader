/** English number words, used for ordinals ("21st" → "twenty-first"). */

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
];
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];

function under1000(n: number): string {
  const parts: string[] = [];
  const h = Math.floor(n / 100);
  const r = n % 100;
  if (h) parts.push(`${ONES[h]} hundred`);
  if (r) {
    if (r < 20) parts.push(ONES[r] ?? '');
    else parts.push(TENS[Math.floor(r / 10)] + (r % 10 ? `-${ONES[r % 10]}` : ''));
  }
  return parts.join(' ');
}

/** Cardinal words for 0 ≤ n < 1e9. */
export function cardinal(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e9) return String(n);
  if (n === 0) return 'zero';
  const out: string[] = [];
  const millions = Math.floor(n / 1e6);
  const thousands = Math.floor((n % 1e6) / 1000);
  const rest = n % 1000;
  if (millions) out.push(`${under1000(millions)} million`);
  if (thousands) out.push(`${under1000(thousands)} thousand`);
  if (rest) out.push(under1000(rest));
  return out.join(' ');
}

const IRREGULAR: Record<string, string> = {
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth',
};

/** Ordinal words: 1 → "first", 22 → "twenty-second", 100 → "one hundredth". */
export function ordinal(n: number): string {
  const words = cardinal(n);
  const m = /([a-z]+)$/.exec(words);
  if (!m) return words;
  const last = m[1] ?? '';
  let ord: string;
  if (IRREGULAR[last]) ord = IRREGULAR[last];
  else if (last.endsWith('y')) ord = `${last.slice(0, -1)}ieth`;
  else ord = `${last}th`;
  return words.slice(0, m.index) + ord;
}
