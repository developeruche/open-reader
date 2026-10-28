import { Tooltip as T } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';

export const TooltipProvider = T.Provider;

export interface TooltipProps {
  label: ReactNode;
  shortcut?: string;
  side?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactElement;
}

export function Tooltip({ label, shortcut, side = 'top', children }: TooltipProps) {
  return (
    <T.Root delayDuration={400}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 flex items-center gap-2 rounded-control bg-ink px-2 py-1 text-xs text-paper shadow-float"
        >
          {label}
          {shortcut ? <span className="font-mono text-[11px] opacity-70">{shortcut}</span> : null}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
