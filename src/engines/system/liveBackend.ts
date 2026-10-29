/**
 * LiveBackend (PLAN.md §5.3): plays system voices through chrome.tts. Word events re-anchor the
 * media clock; rate changes restart speech at the current word, since chrome.tts cannot change
 * rate mid-utterance. Structural pauses are waited out after the utterance ends.
 */
import type { ProcessedAudio } from '@/core/audio/process';
import type { BackendEvent, PlaybackBackend } from '@/core/player/backend';
import type { TtsApi, TtsEvent } from './tts';

export class LiveBackend implements PlaybackBackend {
  private audio: ProcessedAudio | undefined;
  private rate = 1;
  /** Character offset in the utterance where the current speak() call began. */
  private base = 0;
  private anchorTime = 0;
  private anchorEpoch = 0;
  private speaking = false;
  private paused = false;
  private generation = 0;
  private pauseTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly listeners = new Set<(e: BackendEvent) => void>();

  constructor(
    private readonly tts: TtsApi,
    private readonly now: () => number = Date.now,
  ) {}

  play(audio: ProcessedAudio, opts: { rate: number; offset?: number }): void {
    this.stop();
    this.audio = audio;
    this.rate = opts.rate;
    const offset = opts.offset ?? 0;
    const w = audio.words.find((x) => x.end > offset);
    this.speakFrom(w && offset > 0 ? w.charStart : 0, w && offset > 0 ? w.start : 0);
  }

  preload(): void {
    // Nothing to preload: system voices synthesize as they speak.
  }

  pause(): void {
    if (!this.speaking) return;
    this.anchorTime = this.mediaTime();
    this.paused = true;
    this.tts.pause();
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.anchorEpoch = this.now();
    this.tts.resume();
  }

  stop(): void {
    this.generation++;
    if (this.pauseTimer) clearTimeout(this.pauseTimer);
    if (this.speaking) this.tts.stop();
    this.speaking = false;
    this.paused = false;
  }

  setRate(rate: number): void {
    if (rate === this.rate || !this.audio) {
      this.rate = rate;
      return;
    }
    const t = this.mediaTime();
    this.rate = rate;
    if (!this.speaking || this.paused) return;
    // Restart at the current word with the new rate.
    const w = this.audio.words.filter((x) => x.start <= t).at(-1);
    this.tts.stop();
    this.generation++;
    this.speakFrom(w?.charStart ?? 0, w?.start ?? 0);
  }

  mediaTime(): number {
    if (!this.speaking || this.paused) return this.anchorTime;
    return this.anchorTime + ((this.now() - this.anchorEpoch) / 1000) * this.rate;
  }

  subscribe(l: (e: BackendEvent) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  audibleCount(): number {
    return this.speaking && !this.paused ? 1 : 0;
  }

  private speakFrom(charStart: number, mediaTime: number): void {
    const audio = this.audio;
    if (!audio?.utterance) {
      this.emit({ type: 'error', message: 'Nothing to speak' });
      return;
    }
    const gen = ++this.generation;
    this.base = charStart;
    this.anchorTime = mediaTime;
    this.anchorEpoch = this.now();
    this.speaking = true;
    const text = audio.utterance.text.slice(charStart);
    this.tts.speak(
      text,
      {
        voiceName: audio.utterance.voice || undefined,
        lang: audio.utterance.lang,
        rate: this.rate,
      },
      (e) => {
        if (gen !== this.generation) return;
        this.onEvent(e);
      },
    );
  }

  private onEvent(e: TtsEvent): void {
    const audio = this.audio;
    if (!audio) return;
    switch (e.type) {
      case 'start':
        this.anchorEpoch = this.now();
        this.emit({ type: 'started', mediaTime: this.anchorTime, epochMs: this.anchorEpoch });
        break;
      case 'word': {
        if (this.paused) break; // stray events after pause must not move the clock
        const char = this.base + (e.charIndex ?? 0);
        const w = audio.words.find((x) => x.charEnd > char) ?? audio.words.at(-1);
        if (!w) break;
        this.anchorTime = w.start;
        this.anchorEpoch = this.now();
        this.emit({ type: 'progress', mediaTime: w.start, epochMs: this.anchorEpoch });
        break;
      }
      case 'end': {
        // Speech is done; wait out the structural pause before the next segment.
        this.anchorTime = audio.speechEnd;
        this.anchorEpoch = this.now();
        const gen = this.generation;
        const pauseMs = Math.max(0, ((audio.duration - audio.speechEnd) / this.rate) * 1000);
        this.pauseTimer = setTimeout(() => {
          if (gen !== this.generation) return;
          this.speaking = false;
          this.emit({ type: 'ended' });
        }, pauseMs);
        break;
      }
      case 'error':
        this.speaking = false;
        this.emit({ type: 'error', message: e.errorMessage ?? 'System voice error' });
        break;
      default:
        break;
    }
  }

  private emit(e: BackendEvent): void {
    for (const l of this.listeners) l(e);
  }
}
