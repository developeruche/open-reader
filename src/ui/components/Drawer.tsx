import type { ReactNode } from 'react';
import { cn } from '../cn';

export interface DrawerProps {
  side: 'left' | 'right';
  open: boolean;
  label: string;
  children: ReactNode;
  width?: number;
  className?: string;
}

/**
 * A collapsible, non-modal side region (document outline, reading rules). It stays in the
 * layout instead of overlaying the document; collapsed drawers are removed from the tab order.
 */
export function Drawer({ side, open, label, children, width = 280, className }: DrawerProps) {
  return (
    <aside
      aria-label={label}
      hidden={!open}
      style={{ width }}
      className={cn(
        'h-full shrink-0 overflow-y-auto overscroll-contain bg-paper',
        side === 'left' ? 'border-r border-line' : 'border-l border-line',
        className,
      )}
    >
      {children}
    </aside>
  );
}
