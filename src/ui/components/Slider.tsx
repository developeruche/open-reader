import { Slider as S } from 'radix-ui';
import { cn } from '../cn';

export interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onValueChange(value: number): void;
  onValueCommit?(value: number): void;
  /** Human text for screen readers, e.g. "1.5 times". */
  valueText?: (value: number) => string;
  className?: string;
  tone?: 'default' | 'inverse';
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  onValueChange,
  onValueCommit,
  valueText,
  className,
  tone = 'default',
}: SliderProps) {
  const inverse = tone === 'inverse';
  return (
    <S.Root
      className={cn('relative flex h-5 w-full touch-none items-center select-none', className)}
      value={[value]}
      min={min}
      max={max}
      step={step}
      onValueChange={(v) => onValueChange(v[0] ?? value)}
      onValueCommit={(v) => onValueCommit?.(v[0] ?? value)}
    >
      <S.Track
        className={cn('relative h-0.5 grow rounded-full', inverse ? 'bg-paper/25' : 'bg-line')}
      >
        <S.Range className={cn('absolute h-full rounded-full', inverse ? 'bg-paper' : 'bg-ink')} />
      </S.Track>
      <S.Thumb
        aria-label={label}
        aria-valuetext={valueText?.(value)}
        className={cn(
          'relative block size-3.5 rounded-full transition-quiet before:absolute before:-inset-[5px] before:content-[""] hover:scale-110',
          inverse ? 'bg-paper focus-visible:outline-paper' : 'bg-ink',
        )}
      />
    </S.Root>
  );
}
