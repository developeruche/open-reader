import { Crosshair, SkipBack, SkipForward } from '../icons';
import { IconButton, Slider } from '../components';
import { formatTimeLeft } from '../format';
import { PlayButton } from './PlayButton';
import { SpeedControl } from './SpeedControl';
import { VoiceControl, type VoiceOption } from './VoiceControl';

export interface FloatingTransportProps {
  playing: boolean;
  sentence: number;
  total: number;
  rate: number;
  voice: string;
  voices?: readonly VoiceOption[];
  secondsLeft: number;
  follow: boolean;
  onToggle(): void;
  onPrev(): void;
  onNext(): void;
  onSeek(sentence: number): void;
  onRate(rate: number): void;
  onVoice(voice: string): void;
  onFollow(follow: boolean): void;
}

/** Document mode's black pill: play/pause, prev/next, sentence scrubber, speed, voice, time left. */
export function FloatingTransport(p: FloatingTransportProps) {
  return (
    <div
      role="toolbar"
      aria-label="Playback"
      className="flex w-[min(94vw,720px)] items-center gap-2 rounded-full bg-ink py-2 pr-3 pl-2 text-paper shadow-float"
    >
      <PlayButton playing={p.playing} onToggle={p.onToggle} size={44} tone="inverse" />
      <IconButton label="Previous sentence" shortcut="J" tone="inverse" onClick={p.onPrev}>
        <SkipBack size={18} aria-hidden />
      </IconButton>
      <IconButton label="Next sentence" shortcut="K" tone="inverse" onClick={p.onNext}>
        <SkipForward size={18} aria-hidden />
      </IconButton>
      <div className="mx-2 min-w-24 flex-1">
        <Slider
          tone="inverse"
          label="Sentence"
          min={0}
          max={p.total - 1}
          step={1}
          value={p.sentence}
          onValueChange={p.onSeek}
          valueText={(v) => `Sentence ${v + 1} of ${p.total}`}
        />
      </div>
      <span className="hidden text-xs whitespace-nowrap text-paper/70 tabular sm:inline">
        {formatTimeLeft(p.secondsLeft)}
      </span>
      <SpeedControl rate={p.rate} onRateChange={p.onRate} tone="inverse" />
      <VoiceControl voice={p.voice} voices={p.voices} onVoiceChange={p.onVoice} tone="inverse" />
      <button
        type="button"
        aria-pressed={p.follow}
        onClick={() => p.onFollow(!p.follow)}
        className="inline-flex h-8 items-center gap-1.5 rounded-full border border-paper/30 px-3 text-[13px] font-medium transition-quiet hover:bg-paper/10 aria-pressed:bg-paper aria-pressed:text-ink"
      >
        <Crosshair size={14} aria-hidden />
        Follow
      </button>
    </div>
  );
}
