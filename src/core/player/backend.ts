/** Playback backends (PLAN.md §5.3): the player treats rendered PCM and live system TTS alike. */
import type { ProcessedAudio } from '../audio/process';

export type BackendEvent =
  /** Audio is audible; `mediaTime` was current at `epochMs`. */
  | { type: 'started'; mediaTime: number; epochMs: number }
  /** Live speech reached a word boundary: re-anchor the clock (system voices). */
  | { type: 'progress'; mediaTime: number; epochMs: number }
  | { type: 'ended' }
  | { type: 'error'; message: string };

export interface PlaybackBackend {
  /** Starts `audio` at `offset` seconds, replacing whatever was playing (never two at once). */
  play(audio: ProcessedAudio, opts: { rate: number; offset?: number }): void;
  /** Hints the next segment so it starts without a gap. */
  preload(audio: ProcessedAudio): void;
  pause(): void;
  resume(): void;
  stop(): void;
  setRate(rate: number): void;
  /** Media time (seconds) of the current segment. */
  mediaTime(): number;
  subscribe(listener: (e: BackendEvent) => void): () => void;
}
