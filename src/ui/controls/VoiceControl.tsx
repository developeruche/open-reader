import { Check, ChevronDown } from '../icons';
import { Popover } from '../components';
import { cn } from '../cn';
import { MOCK_VOICES } from '../mock/mockDocument';

export interface VoiceControlProps {
  voice: string;
  onVoiceChange(voice: string): void;
  tone?: 'default' | 'inverse';
}

export function VoiceControl({ voice, onVoiceChange, tone = 'default' }: VoiceControlProps) {
  const current = MOCK_VOICES.find((v) => v.id === voice) ?? MOCK_VOICES[0];
  return (
    <Popover
      label="Voice"
      side={tone === 'inverse' ? 'top' : 'bottom'}
      align="end"
      className="w-72 p-1"
      trigger={
        <button
          type="button"
          aria-label={`Voice: ${current.name}`}
          className={cn(
            'inline-flex h-8 max-w-40 items-center gap-1 rounded-full border pr-2 pl-3 text-[13px] font-medium transition-quiet',
            tone === 'inverse'
              ? 'border-paper/30 text-paper hover:bg-paper/10'
              : 'border-line text-ink hover:bg-hover',
          )}
        >
          <span className="truncate">{current.name}</span>
          <ChevronDown size={14} aria-hidden />
        </button>
      }
    >
      <div role="radiogroup" aria-label="Voice">
        {MOCK_VOICES.map((v) => (
          <button
            key={v.id}
            type="button"
            role="radio"
            aria-checked={v.id === voice}
            onClick={() => onVoiceChange(v.id)}
            className="flex w-full items-center gap-3 rounded-control px-3 py-2 text-left hover:bg-hover"
          >
            <span className="flex size-4 items-center justify-center">
              {v.id === voice ? <Check size={14} aria-hidden /> : null}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm text-ink">{v.name}</span>
              <span className="block text-xs text-muted">{v.detail}</span>
            </span>
          </button>
        ))}
      </div>
    </Popover>
  );
}
