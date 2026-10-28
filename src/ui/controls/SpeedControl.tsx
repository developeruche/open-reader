import { Button, Popover, Slider } from '../components';
import { cn } from '../cn';
import { formatRate } from '../format';

export const SPEED_PRESETS = [0.75, 1, 1.25, 1.5, 2, 2.5, 3] as const;

export interface SpeedControlProps {
  rate: number;
  onRateChange(rate: number): void;
  tone?: 'default' | 'inverse';
}

/** The speed chip ("1.0×") opening a 0.5–4× slider with presets. */
export function SpeedControl({ rate, onRateChange, tone = 'default' }: SpeedControlProps) {
  return (
    <Popover
      label="Playback speed"
      side={tone === 'inverse' ? 'top' : 'bottom'}
      className="w-72"
      trigger={
        <button
          type="button"
          aria-label={`Speed ${formatRate(rate)}`}
          className={cn(
            'inline-flex h-8 items-center rounded-full border px-3 text-[13px] font-medium tabular transition-quiet',
            tone === 'inverse'
              ? 'border-paper/30 text-paper hover:bg-paper/10'
              : 'border-line text-ink hover:bg-hover',
          )}
        >
          {formatRate(rate)}
        </button>
      }
    >
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-medium">Speed</h3>
        <span className="text-sm tabular text-ink-2">{formatRate(rate)}</span>
      </div>
      <Slider
        className="mt-4"
        label="Speed"
        min={0.5}
        max={4}
        step={0.05}
        value={rate}
        onValueChange={onRateChange}
        valueText={(v) => `${formatRate(v).replace('×', '')} times`}
      />
      <div className="mt-4 flex flex-wrap gap-1.5">
        {SPEED_PRESETS.map((p) => (
          <Button
            key={p}
            size="sm"
            variant={p === rate ? 'primary' : 'secondary'}
            aria-pressed={p === rate}
            onClick={() => onRateChange(p)}
            className="tabular"
          >
            {formatRate(p)}
          </Button>
        ))}
      </div>
    </Popover>
  );
}
