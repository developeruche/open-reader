/** First focusable element on full pages: jumps past navigation to #content. */
export function SkipLink({ target = 'content' }: { target?: string }) {
  return (
    <a
      href={`#${target}`}
      className="fixed top-2 left-2 z-50 -translate-y-16 rounded-control bg-ink px-3 py-2 text-sm text-paper transition-quiet focus-visible:translate-y-0"
    >
      Skip to content
    </a>
  );
}
