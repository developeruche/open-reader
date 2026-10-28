import { Pause, Play } from '../icons';
import { cn } from '../cn';
import { Tooltip } from '../components';

export interface PlayButtonProps {
  playing: boolean;
  onToggle(): void;
  size?: 56 | 44 | 36;
  tone?: 'default' | 'inverse';
}

/** The round ink Play/Pause button: the one heavy element in every transport. */
export function PlayButton({ playing, onToggle, size = 56, tone = 'default' }: PlayButtonProps) {
  const label = playing ? 'Pause' : 'Play';
  return (
    <Tooltip label={label} shortcut="Space">
      <button
        type="button"
        aria-label={label}
        aria-pressed={playing}
        onClick={onToggle}
        style={{ width: size, height: size }}
        className={cn(
          'inline-flex shrink-0 items-center justify-center rounded-full transition-quiet active:scale-95',
          tone === 'default'
            ? 'bg-ink text-paper hover:opacity-90'
            : 'bg-paper text-ink hover:opacity-90',
        )}
      >
        {playing ? (
          <Pause size={size * 0.4} aria-hidden fill="currentColor" />
        ) : (
          <Play size={size * 0.4} aria-hidden fill="currentColor" className="translate-x-[1px]" />
        )}
      </button>
    </Tooltip>
  );
}
