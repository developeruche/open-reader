import { Popover as P } from 'radix-ui';
import type { ReactElement, ReactNode } from 'react';
import { cn } from '../cn';

export interface PopoverProps {
  trigger: ReactElement;
  label: string;
  children: ReactNode;
  side?: 'top' | 'bottom';
  align?: 'start' | 'center' | 'end';
  className?: string;
  open?: boolean;
  onOpenChange?(open: boolean): void;
}

export function Popover({
  trigger,
  label,
  children,
  side = 'bottom',
  align = 'center',
  className,
  open,
  onOpenChange,
}: PopoverProps) {
  return (
    <P.Root open={open} onOpenChange={onOpenChange}>
      <P.Trigger asChild>{trigger}</P.Trigger>
      <P.Portal>
        <P.Content
          aria-label={label}
          side={side}
          align={align}
          sideOffset={8}
          collisionPadding={12}
          className={cn(
            'z-50 rounded-card border border-line bg-paper p-4 text-ink shadow-float outline-none',
            className,
          )}
        >
          {children}
        </P.Content>
      </P.Portal>
    </P.Root>
  );
}
