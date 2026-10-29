import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { cn } from '../cn';
import { prefersReducedMotion } from '../theme';
import type { MockBlock } from '../mock/mockDocument';

export interface ReadingViewProps {
  blocks: MockBlock[];
  /** Global sentence index and word index within it. */
  sentence: number;
  word: number;
  active: boolean;
  follow: boolean;
  onSeek(sentence: number): void;
  className?: string;
}

/**
 * The reader view: blocks rendered from the document model (never page HTML), with the current
 * sentence tinted, the current word ink-inverted and a 2px cursor bar gliding under it.
 */
export function ReadingView({
  blocks,
  sentence,
  word,
  active,
  follow,
  onSeek,
  className,
}: ReadingViewProps) {
  const rootRef = useRef<HTMLElement>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number; w: number } | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const el = root?.querySelector<HTMLElement>('[data-current-word]');
    if (!root || !el || !active) return setCursor(null);
    const r = el.getBoundingClientRect();
    const o = root.getBoundingClientRect();
    setCursor({ x: r.left - o.left, y: r.bottom - o.top + root.scrollTop + 2, w: r.width });
  }, [sentence, word, active]);

  useEffect(() => {
    if (!follow) return;
    const el = rootRef.current?.querySelector<HTMLElement>('[data-current-sentence]');
    el?.scrollIntoView({
      block: 'nearest',
      behavior: prefersReducedMotion() ? 'instant' : 'smooth',
    });
  }, [sentence, follow]);

  // Delegated click-to-seek; keyboard users seek with J/K and the outline.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onClick = (e: MouseEvent) => {
      const s = (e.target as HTMLElement).closest<HTMLElement>('[data-sentence-index]');
      if (s) onSeek(Number(s.dataset.sentenceIndex));
    };
    root.addEventListener('click', onClick);
    return () => root.removeEventListener('click', onClick);
  }, [onSeek]);

  let index = 0;
  return (
    <article
      ref={rootRef}
      className={cn('relative font-serif text-[19px] leading-[1.6] text-ink', className)}
    >
      {blocks.map((b) => {
        const content = b.sentences.map((s) => {
          const i = index++;
          if (b.muted)
            return (
              <span key={s.id} className="text-muted">
                {s.text}{' '}
              </span>
            );
          const isCurrent = i === sentence;
          const w = isCurrent ? s.words[word] : undefined;
          return (
            <span
              key={s.id}
              data-sentence-index={i}
              data-current-sentence={isCurrent || undefined}
              className={cn(
                'rounded-[3px] transition-quiet',
                isCurrent && 'bg-sentence',
                !isCurrent && 'hover:bg-hover',
              )}
            >
              {w && active ? (
                <>
                  {s.text.slice(0, w.start)}
                  <span
                    data-current-word
                    className="rounded-[2px] bg-word-bg text-word-fg shadow-[0_0_0_2px_var(--word-bg)]"
                  >
                    {s.text.slice(w.start, w.end)}
                  </span>
                  {s.text.slice(w.end)}
                </>
              ) : (
                s.text
              )}{' '}
            </span>
          );
        });
        if (b.type === 'heading') {
          const H = b.level === 1 ? 'h2' : 'h3';
          return (
            <H
              key={b.id}
              className={cn(
                'mt-8 mb-3 font-serif tracking-[-0.015em]',
                b.level === 1 ? 'text-[26px] leading-tight' : 'text-[21px] leading-snug',
              )}
            >
              {content}
            </H>
          );
        }
        if (b.type === 'listItem') {
          return (
            <p
              key={b.id}
              className="relative my-1.5 pl-5 before:absolute before:left-1 before:text-muted before:content-['–']"
            >
              {content}
            </p>
          );
        }
        return (
          <p key={b.id} className="my-4">
            {content}
          </p>
        );
      })}
      {cursor ? (
        <span
          aria-hidden
          data-reading-cursor
          className="pointer-events-none absolute top-0 left-0 h-0.5 w-[100px] origin-left rounded-full bg-ink"
          style={{
            // Compositor-only motion: position and length both live in the transform.
            transform: `translate(${cursor.x}px, ${cursor.y}px) scaleX(${cursor.w / 100})`,
            transition: 'transform var(--dur-cursor) var(--ease)',
          }}
        />
      ) : null}
    </article>
  );
}
