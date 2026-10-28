import { Dialog as D } from 'radix-ui';
import type { ReactNode } from 'react';
import { X } from '../icons';
import { IconButton } from './IconButton';

export interface DialogProps {
  open?: boolean;
  onOpenChange?(open: boolean): void;
  trigger?: ReactNode;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
}

export function Dialog({
  open,
  onOpenChange,
  trigger,
  title,
  description,
  children,
  footer,
}: DialogProps) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      {trigger ? <D.Trigger asChild>{trigger}</D.Trigger> : null}
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-40 bg-ink/30" />
        <D.Content className="fixed top-1/2 left-1/2 z-50 w-[min(92vw,440px)] -translate-x-1/2 -translate-y-1/2 rounded-card border border-line bg-paper p-6 shadow-float">
          <div className="flex items-start justify-between gap-4">
            <D.Title className="font-serif text-xl tracking-tight text-ink">{title}</D.Title>
            <D.Close asChild>
              <IconButton label="Close" size="sm" tooltip={false}>
                <X size={16} aria-hidden />
              </IconButton>
            </D.Close>
          </div>
          {description ? (
            <D.Description className="mt-2 text-sm text-ink-2">{description}</D.Description>
          ) : (
            <D.Description className="visually-hidden">{title}</D.Description>
          )}
          {children ? <div className="mt-4">{children}</div> : null}
          {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}
