import { useEffect, useState } from 'react';
import { prefersReducedMotion } from '../theme';

const LINE = 'A cursor follows every word, so you can look away and find your place again.';
const WORDS = [...new Intl.Segmenter('en', { granularity: 'word' }).segment(LINE)].filter(
  (w) => w.isWordLike,
);

/** The signature reading line, animated word by word (static under reduced motion). */
export function ReadingDemo() {
  const [i, setI] = useState(2);
  useEffect(() => {
    if (prefersReducedMotion()) return;
    const t = setInterval(() => setI((n) => (n + 1) % WORDS.length), 360);
    return () => clearInterval(t);
  }, []);
  const w = WORDS[i] ?? WORDS[0];
  if (!w) return null;
  const end = w.index + w.segment.length;
  return (
    <p aria-hidden className="font-serif text-[24px] leading-[1.6] text-ink">
      <span className="rounded-[3px] bg-sentence">
        {LINE.slice(0, w.index)}
        <span className="relative rounded-[2px] bg-word-bg text-word-fg shadow-[0_0_0_2px_var(--word-bg)]">
          {w.segment}
          <span className="absolute -bottom-1.5 left-0 h-0.5 w-full rounded-full bg-ink" />
        </span>
        {LINE.slice(end)}
      </span>
    </p>
  );
}
