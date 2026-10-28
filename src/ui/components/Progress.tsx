import { Progress as P } from 'radix-ui';
import { cn } from '../cn';

export interface ProgressProps {
  label: string;
  /** 0..1, or null for indeterminate. */
  value: number | null;
  className?: string;
}

export function Progress({ label, value, className }: ProgressProps) {
  return (
    <P.Root
      aria-label={label}
      value={value === null ? null : Math.round(value * 100)}
      className={cn('relative h-1 w-full overflow-hidden rounded-full bg-line', className)}
    >
      <P.Indicator
        className={cn(
          'h-full w-full origin-left bg-ink transition-transform duration-(--dur) ease-out',
          value === null && 'motion-safe:animate-pulse',
        )}
        style={{ transform: `scaleX(${value === null ? 0.33 : Math.max(0, Math.min(1, value))})` }}
      />
    </P.Root>
  );
}
