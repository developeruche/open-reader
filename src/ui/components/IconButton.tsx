import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn';
import { Tooltip } from './Tooltip';

export interface IconButtonProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label'
> {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  shortcut?: string;
  size?: 'sm' | 'md' | 'lg';
  tone?: 'default' | 'inverse';
  tooltip?: boolean;
  children: ReactNode;
}

const SIZES = { sm: 'size-8', md: 'size-9', lg: 'size-10' } as const;

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  {
    label,
    shortcut,
    size = 'md',
    tone = 'default',
    tooltip = true,
    className,
    children,
    type = 'button',
    ...props
  },
  ref,
) {
  const button = (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-control transition-quiet',
        'disabled:pointer-events-none disabled:opacity-40',
        tone === 'default'
          ? 'text-ink hover:bg-hover active:bg-press'
          : 'text-paper hover:bg-paper/10 active:bg-paper/20',
        SIZES[size],
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
  return tooltip ? (
    <Tooltip label={label} shortcut={shortcut}>
      {button}
    </Tooltip>
  ) : (
    button
  );
});
