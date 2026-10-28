import { describe, expect, it } from 'vitest';
import {
  clauseBoundaries,
  isFalseBreak,
  segmentSentences,
  segmentWords,
} from '@/core/text/segment';

const sentences = (t: string) => segmentSentences(t).map((s) => t.slice(s.start, s.end));
const words = (t: string) => segmentWords(t).map((s) => t.slice(s.start, s.end));

describe('sentence segmentation', () => {
  it.each([
    ['Use e.g. a fork. Then go.', ['Use e.g. a fork.', 'Then go.']],
    ['Use i.e. this one. Ok.', ['Use i.e. this one.', 'Ok.']],
    ['See Fig. 3 for details. Next.', ['See Fig. 3 for details.', 'Next.']],
    ['See Fig. A for details. Next.', ['See Fig. A for details.', 'Next.']],
    ['Dr. Smith arrived. He sat.', ['Dr. Smith arrived.', 'He sat.']],
    ['Mr. and Mrs. Jones left. Bye.', ['Mr. and Mrs. Jones left.', 'Bye.']],
    ['Prof. Lee spoke. Then Dr. Kim.', ['Prof. Lee spoke.', 'Then Dr. Kim.']],
    ['We met in St. Louis. It rained.', ['We met in St. Louis.', 'It rained.']],
    ['J. R. R. Tolkien wrote it. Fine.', ['J. R. R. Tolkien wrote it.', 'Fine.']],
    ['John F. Kennedy spoke. Crowds cheered.', ['John F. Kennedy spoke.', 'Crowds cheered.']],
    ['We chose plan B. Then we left.', ['We chose plan B.', 'Then we left.']],
    ['Take vitamin C. The cold ends.', ['Take vitamin C.', 'The cold ends.']],
    ['Pi is 3.14 today. Yes.', ['Pi is 3.14 today.', 'Yes.']],
    ['Upgrade to v2.0.0 now. Done.', ['Upgrade to v2.0.0 now.', 'Done.']],
    ['Visit example.com/foo.bar today. Ok.', ['Visit example.com/foo.bar today.', 'Ok.']],
    ['See https://example.com. Then stop.', ['See https://example.com.', 'Then stop.']],
    ['Wait... what happened? Nothing.', ['Wait... what happened?', 'Nothing.']],
    ['Wait… what happened? Nothing.', ['Wait… what happened?', 'Nothing.']],
    ['He said "Stop." Then he left.', ['He said "Stop."', 'Then he left.']],
    ['He said “Stop.” Then he left.', ['He said “Stop.”', 'Then he left.']],
    ['Smith et al. found it. Others agree.', ['Smith et al. found it.', 'Others agree.']],
    ['It costs approx. 5 dollars. Cheap.', ['It costs approx. 5 dollars.', 'Cheap.']],
    ['The U.S. economy grew. Again.', ['The U.S. economy grew.', 'Again.']],
    ['Vol. 2 is out. Read it.', ['Vol. 2 is out.', 'Read it.']],
    ['At 5 p.m. we left. Late.', ['At 5 p.m. we left.', 'Late.']],
    ['He was No. 1 in class. Wow.', ['He was No. 1 in class.', 'Wow.']],
    ['Compare A vs. B today. Fine.', ['Compare A vs. B today.', 'Fine.']],
    ['It happened on Sept. 5 last year. Ok.', ['It happened on Sept. 5 last year.', 'Ok.']],
    ['Really?! Yes.', ['Really?!', 'Yes.']],
    ['One. Two. Three.', ['One.', 'Two.', 'Three.']],
    ['No terminal punctuation', ['No terminal punctuation']],
    ['  Leading and trailing space.  ', ['Leading and trailing space.']],
    ['', []],
    ['   ', []],
  ])('%j', (text, expected) => {
    expect(sentences(text)).toEqual(expected);
  });

  it('spans are trimmed and ordered', () => {
    const t = 'First one.  Second one!   Third?';
    const spans = segmentSentences(t);
    for (let i = 1; i < spans.length; i++)
      expect(spans[i]!.start).toBeGreaterThanOrEqual(spans[i - 1]!.end);
    for (const s of spans) expect(t.slice(s.start, s.end)).toBe(t.slice(s.start, s.end).trim());
  });

  it('detects false breaks directly', () => {
    expect(isFalseBreak('Dr. ', 'Smith')).toBe(true);
    expect(isFalseBreak('It ended. ', 'Then')).toBe(false);
    expect(isFalseBreak('No dot ', 'Next')).toBe(false);
  });
});

describe('word segmentation', () => {
  it('keeps versions, decimals and contractions as single words', () => {
    expect(words("PSBTs v2.0.0 3.14 don’t it's")).toEqual([
      'PSBTs',
      'v2.0.0',
      '3.14',
      'don’t',
      "it's",
    ]);
  });

  it('splits on punctuation and returns absolute offsets', () => {
    const t = 'xx Hello, world!';
    expect(segmentWords(t, 3)).toEqual([
      { start: 3, end: 8 },
      { start: 10, end: 15 },
    ]);
  });
});

describe('clause boundaries', () => {
  it('finds commas, semicolons, colons and dashes followed by a space', () => {
    const t = 'One, two; three: four — five, six';
    expect(clauseBoundaries(t).map((i) => t.slice(0, i).slice(-1))).toEqual([
      ',',
      ';',
      ':',
      '—',
      ',',
    ]);
  });
  it('ignores commas inside numbers', () => {
    expect(clauseBoundaries('It was 1,000 sats')).toEqual([]);
  });
});
