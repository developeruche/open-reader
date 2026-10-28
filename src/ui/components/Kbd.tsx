import type { ReactNode } from 'react';

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-6 min-w-6 items-center justify-center rounded-[4px] border border-line bg-paper-2 px-1.5 font-mono text-xs text-ink">
      {children}
    </kbd>
  );
}
