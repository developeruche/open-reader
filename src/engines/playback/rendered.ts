/**
 * RenderedBackend (PLAN.md §5.4.2): plays our PCM through two alternating HTMLAudioElements
 * (the next one preloaded), with preservesPitch so speed changes keep pitch. Only one element is
 * ever audible: play() pauses and resets the other before starting.
 */
import type { ProcessedAudio } from '@/core/audio/process';
import { encodeWav } from '@/core/audio/wav';
import type { BackendEvent, PlaybackBackend } from '@/core/player/backend';

interface Deck {
  el: HTMLAudioElement;
  audio?: ProcessedAudio;
  url?: string;
}

/** How often to look for the media clock to start moving after `playing`, and for how long. */
export const START_POLL_MS = 4;
export const START_POLL_LIMIT_MS = 250;

export class RenderedBackend implements PlaybackBackend {
  private readonly decks: [Deck, Deck];
  private active = 0;
  private rate = 1;
  private readonly listeners = new Set<(e: BackendEvent) => void>();
  private startToken = 0;

  constructor(
    createAudio: () => HTMLAudioElement = () => new Audio(),
    private readonly now: () => number = Date.now,
  ) {
    this.decks = [{ el: createAudio() }, { el: createAudio() }];
    for (const [i, d] of this.decks.entries()) {
      d.el.preservesPitch = true;
      d.el.preload = 'auto';
      d.el.addEventListener('playing', () => i === this.active && this.announceStart(d.el));
      d.el.addEventListener('ended', () => i === this.active && this.emit({ type: 'ended' }));
      d.el.addEventListener(
        'error',
        () =>
          i === this.active &&
          this.emit({
            type: 'error',
            message: d.el.error?.message || `media error ${d.el.error?.code ?? ''}`,
          }),
      );
    }
  }

  play(audio: ProcessedAudio, opts: { rate: number; offset?: number }): void {
    const other = this.decks[1 - this.active] as Deck;
    // Reuse the preloaded deck if it holds this audio.
    const useOther = other.audio === audio;
    if (useOther) this.active = 1 - this.active;
    const deck = this.decks[this.active] as Deck;
    const idle = this.decks[1 - this.active] as Deck;
    idle.el.pause();
    if (!useOther) this.load(deck, audio);
    this.rate = opts.rate;
    deck.el.playbackRate = opts.rate;
    deck.el.defaultPlaybackRate = opts.rate;
    deck.el.currentTime = opts.offset ?? 0;
    void deck.el
      .play()
      .catch((e: unknown) =>
        this.emit({ type: 'error', message: e instanceof Error ? e.message : String(e) }),
      );
  }

  preload(audio: ProcessedAudio): void {
    const deck = this.decks[1 - this.active] as Deck;
    if (deck.audio === audio) return;
    deck.el.pause();
    this.load(deck, audio);
  }

  pause(): void {
    this.startToken++;
    this.decks[this.active]?.el.pause();
  }

  /**
   * `playing` fires before Chrome's media clock moves (~50 ms of output latency), so anchoring
   * there runs the highlight ahead. Wait for currentTime to advance, then report the real clock.
   */
  private announceStart(el: HTMLAudioElement): void {
    const token = ++this.startToken;
    const from = el.currentTime;
    let tries = Math.ceil(START_POLL_LIMIT_MS / START_POLL_MS);
    const check = () => {
      if (token !== this.startToken || el.paused) return;
      if (el.currentTime === from && tries-- > 0) {
        setTimeout(check, START_POLL_MS);
        return;
      }
      this.emit({ type: 'started', mediaTime: el.currentTime, epochMs: this.now() });
    };
    check();
  }

  resume(): void {
    const el = this.decks[this.active]?.el;
    if (!el) return;
    el.playbackRate = this.rate;
    void el
      .play()
      .catch((e: unknown) =>
        this.emit({ type: 'error', message: e instanceof Error ? e.message : String(e) }),
      );
  }

  stop(): void {
    this.startToken++;
    for (const d of this.decks) {
      d.el.pause();
      this.unload(d);
    }
  }

  setRate(rate: number): void {
    this.rate = rate;
    for (const d of this.decks) {
      d.el.playbackRate = rate;
      d.el.defaultPlaybackRate = rate;
    }
  }

  mediaTime(): number {
    return this.decks[this.active]?.el.currentTime ?? 0;
  }

  subscribe(listener: (e: BackendEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** For diagnostics and tests: how many elements are currently playing. */
  audibleCount(): number {
    return this.decks.filter((d) => !d.el.paused && !d.el.ended).length;
  }

  private load(deck: Deck, audio: ProcessedAudio): void {
    this.unload(deck);
    const bytes = encodeWav(audio.pcm, audio.sampleRate);
    deck.url = URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer], { type: 'audio/wav' }));
    deck.audio = audio;
    deck.el.src = deck.url;
    deck.el.load();
  }

  private unload(deck: Deck): void {
    if (deck.url) URL.revokeObjectURL(deck.url);
    deck.url = undefined;
    deck.audio = undefined;
  }

  private emit(e: BackendEvent): void {
    for (const l of this.listeners) l(e);
  }
}
