import type { ProcessedAudio } from '@/core/audio/process';
import type { BackendEvent, PlaybackBackend } from '@/core/player/backend';

/** Simulated audio output on (fake) timers; tracks how many segments are audible. */
export class FakeBackend implements PlaybackBackend {
  audio: ProcessedAudio | undefined;
  playing = false;
  rate = 1;
  maxAudible = 0;
  plays: { audio: ProcessedAudio; offset: number; rate: number }[] = [];
  preloaded: ProcessedAudio[] = [];
  /** When true, media time stops advancing (simulated stall). */
  frozen = false;
  private base = 0;
  private startedAt = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(e: BackendEvent) => void>();

  play(audio: ProcessedAudio, opts: { rate: number; offset?: number }): void {
    this.clear();
    this.audio = audio;
    this.rate = opts.rate;
    this.base = opts.offset ?? 0;
    this.plays.push({ audio, offset: this.base, rate: opts.rate });
    this.begin();
  }

  preload(audio: ProcessedAudio): void {
    this.preloaded.push(audio);
  }

  pause(): void {
    this.base = this.mediaTime();
    this.playing = false;
    this.clear();
  }

  resume(): void {
    if (this.audio) this.begin();
  }

  stop(): void {
    this.clear();
    this.playing = false;
    this.audio = undefined;
    this.base = 0;
  }

  setRate(rate: number): void {
    const t = this.mediaTime();
    this.rate = rate;
    if (this.playing) {
      this.base = t;
      this.clear();
      this.begin();
    }
  }

  mediaTime(): number {
    if (!this.playing || this.frozen) return this.base;
    return Math.min(
      this.audio?.duration ?? 0,
      this.base + ((Date.now() - this.startedAt) / 1000) * this.rate,
    );
  }

  subscribe(l: (e: BackendEvent) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  freeze(): void {
    this.base = this.mediaTime();
    this.frozen = true;
    this.clear();
  }

  private begin(): void {
    this.playing = true;
    this.maxAudible = Math.max(this.maxAudible, 1);
    this.startedAt = Date.now();
    const at = this.base;
    queueMicrotask(() => this.emit({ type: 'started', mediaTime: at, epochMs: Date.now() }));
    if (this.frozen) return;
    const ms = (((this.audio?.duration ?? 0) - this.base) / this.rate) * 1000;
    this.timer = setTimeout(
      () => {
        this.playing = false;
        this.base = this.audio?.duration ?? 0;
        this.emit({ type: 'ended' });
      },
      Math.max(0, ms),
    );
  }

  private clear(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
  }

  private emit(e: BackendEvent): void {
    for (const l of this.listeners) l(e);
  }
}
