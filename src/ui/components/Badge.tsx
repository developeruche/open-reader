import type { ReactNode } from 'react';
import { cn } from '../cn';

export function Badge({
  children,
  tone = 'outline',
}: {
  children: ReactNode;
  tone?: 'outline' | 'solid';
}) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center gap-1 rounded-full px-2 text-xs font-medium',
        tone === 'solid' ? 'bg-ink text-paper' : 'border border-line text-ink-2',
      )}
    >
      {children}
    </span>
  );
}
