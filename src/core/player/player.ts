/**
 * The Player: wires the state machine to the scheduler, cache, engine, playback backend and the
 * sync protocol. Pure TypeScript with injected dependencies; hosts (offscreen, reader page) supply
 * the real backend and engine.
 */
import { createActor, type Actor, type SnapshotFrom } from 'xstate';
import type { ProcessedAudio } from '../audio/process';
import { estimateTimings, type WordTiming } from '../audio/timing';
import type { ReadingDocument, ReadingPosition } from '../document/model';
import { Navigator, type SentenceRef } from '../document/positions';
import { Lexicon } from '../text/lexicon';
import { RtfMonitor } from '../models/benchmark';
import type { PacingPreset } from '../text/pacing';
import type { SpokenSegment } from '../text/segments';
import { DEFAULT_SKIP_RULES, type SkipRules } from '../text/skip';
import { isAbort, type RenderEngine } from '../tts/engine';
import type { BackendEvent, PlaybackBackend } from './backend';
import type { SynthesisCache } from './cache';
import {
  playerMachine,
  type Cursor,
  type NavEvent,
  type PlayerContext,
  type PlayerEvent,
  type PlayerNav,
  type PlayerStateValue,
} from './machine';
import { renderSegment, sentenceSegments } from './render';
import { PrefetchScheduler, type Wanted } from './scheduler';
import { anchorFor, type SyncEvent, type SyncWord } from './sync';

export interface PlayerSettings {
  rate: number;
  voice: string;
  pacing: PacingPreset;
  skipRules: SkipRules;
  lexicon?: Lexicon;
}

export interface PlayerNotice {
  kind: 'info' | 'error';
  message: string;
  /** Technical detail shown under the message (e.g. the error behind an engine switch). */
  detail?: string;
}

/** Live numbers for Diagnostics (§9.2). */
export interface PlayerStats {
  /** Mean real-time factor of the last few synthesized segments (null before the first). */
  rtf: number | null;
  synthesized: number;
  cacheHits: number;
  /** Seconds of ready speech ahead of the playhead, at 1× (what the 20 s prefetch target counts). */
  bufferAhead: number;
  stalls: number;
  errors: number;
}

export const NOTHING_TO_READ = 'Nothing to read here';
export const SLOW_VOICE_NOTICE =
  'This voice is slower than real time on this device, so playback may pause. A faster voice such as Piper keeps up: choose it in Settings → Voices & models.';
const RTF_SAMPLES = 8;

export interface PlayerDeps {
  doc: ReadingDocument;
  engine: RenderEngine;
  model: { modelId: string; version: string };
  backend: PlaybackBackend;
  sessionId: string;
  cache?: SynthesisCache;
  settings?: Partial<PlayerSettings>;
  start?: { sentence: number; word?: number };
  onSync?(e: SyncEvent): void;
  onPersist?(p: ReadingPosition): void;
  onNotice?(n: PlayerNotice): void;
  /** Called after repeated stalls (§9.2): the host restarts the engine worker. */
  onEngineRestart?(): void;
  now?(): number;
  /** Concurrent synthesis jobs: 1 on WebGPU, up to 2 on WASM (§5.4.3). */
  concurrency?: number;
}

export interface PreparedSegment {
  segment: SpokenSegment;
  audio: ProcessedAudio;
  sync: SyncWord[];
  /** Model speed used (above 2× we synthesize faster and slow the playback rate down). */
  modelSpeed: number;
  fromCache: boolean;
}

/** Ahead-of-playhead targets (§5.4.3). */
export const PREFETCH_SECONDS = 20;
export const PREFETCH_SEGMENTS = 4;
const MAX_WINDOW = 40;
/** Rough speech rate for planning, seconds per spoken character at model speed 1. */
const SECONDS_PER_CHAR = 0.07;
export const WATCHDOG_MS = 500;
export const STALL_MS = 2000;
export const DRIFT_MS = 2000;
/** One extra correction shortly after each segment starts, while the media clock settles. */
export const EARLY_DRIFT_MS = 300;
export const STALLS_BEFORE_RESTART = 3;
/** Planning estimate for system voices at rate 1 (re-anchored by word events while speaking). */
const LIVE_SECONDS_PER_CHAR = 0.065;

/** Above 2× we synthesize at 1.25× and divide the playback rate (§5.4.2). */
export function modelSpeedFor(rate: number): number {
  return rate > 2 ? 1.25 : 1;
}

export class Player {
  readonly nav: Navigator;
  readonly actor: Actor<typeof playerMachine>;
  readonly scheduler: PrefetchScheduler<PreparedSegment>;
  private readonly segments = new Map<number, SpokenSegment[]>();
  private settings: PlayerSettings;
  private lexicon: Lexicon;
  private requestToken = 0;
  private fastStartSentence: number | undefined;
  private current: PreparedSegment | undefined;
  private lastPersisted = '';
  private watchdog: ReturnType<typeof setInterval> | undefined;
  private lastMediaTime = -1;
  private lastProgressAt = 0;
  private stalls = 0;
  private lastDriftAt = 0;
  private earlyDrift: ReturnType<typeof setTimeout> | undefined;
  /** The segment whose SEGMENT_STARTED went out: clock corrections only apply to it. */
  private announced: PreparedSegment | undefined;
  private readonly unsubscribeBackend: () => void;
  private readonly now: () => number;
  private readonly rtfMonitor = new RtfMonitor();
  private readonly rtfs: number[] = [];
  private slowNoticeShown = false;
  private readonly counters = { synthesized: 0, cacheHits: 0, stalls: 0, errors: 0 };

  constructor(private readonly deps: PlayerDeps) {
    this.now = deps.now ?? Date.now;
    this.settings = {
      rate: 1,
      voice: 'default',
      pacing: 'natural',
      skipRules: DEFAULT_SKIP_RULES,
      ...deps.settings,
    };
    this.lexicon = this.settings.lexicon ?? new Lexicon({ engineId: deps.engine.id });
    this.nav = new Navigator(deps.doc, {
      announceSkippedCode: this.settings.skipRules.announceSkippedCode,
    });
    this.scheduler = new PrefetchScheduler(
      (key, signal) => this.prepare(key, signal),
      deps.concurrency ?? 1,
    );
    // Real durations replace estimates as segments arrive: extend the window to keep 20 s ahead.
    this.scheduler.onReady = () => {
      if (this.state === 'playing') this.scheduler.want(this.window(this.cursor));
    };

    const nav: PlayerNav = {
      next: (c) => this.nextCursor(c),
      resolve: (e, c) => this.resolveNav(e, c),
    };
    // Actions run before the snapshot updates, so they read settings from the machine context.
    const withCtx =
      <A extends unknown[]>(fn: (ctx: PlayerContext, ...a: A) => void) =>
      ({ context }: { context: PlayerContext }, ...a: A) => {
        this.settings.rate = context.rate;
        this.settings.voice = context.voice;
        this.settings.pacing = context.pacing;
        fn(context, ...a);
      };
    const machine = playerMachine.provide({
      actions: {
        requestSegment: withCtx((c) => this.requestSegment(c.cursor)),
        startAudio: withCtx((c) => this.startAudio(c.cursor, c.loaded)),
        pauseAudio: () => this.pauseAudio(),
        stopAudio: () => this.stopAudio(),
        applyRate: withCtx((c) => this.applyRate(c.rate)),
        persist: ({ context }) => this.persist(context.cursor),
        replan: withCtx(() => this.replan()),
        announceError: ({ context }) =>
          deps.onNotice?.({ kind: 'error', message: context.error?.message ?? 'Playback failed' }),
      },
    });
    const start = this.speakableFrom(
      deps.start ? this.nav.clamp(deps.start.sentence) : 0,
      deps.start?.word ?? 0,
    );
    this.actor = createActor(machine, {
      input: {
        nav,
        start,
        rate: this.settings.rate,
        voice: this.settings.voice,
        pacing: this.settings.pacing,
      },
    });
    this.unsubscribeBackend = deps.backend.subscribe((e) => this.onBackend(e));
    this.actor.subscribe((s) => {
      // Mirror context into settings so segment building uses the latest values.
      this.settings.rate = s.context.rate;
      this.settings.voice = s.context.voice;
      this.settings.pacing = s.context.pacing;
      if (s.value === 'playing') this.startWatchdog();
      else this.stopWatchdog();
    });
    this.actor.start();
  }

  send(e: PlayerEvent): void {
    if (e.type === 'PLAY' && this.fastStartSentence === undefined) {
      this.fastStartSentence = this.actor.getSnapshot().context.cursor.sentence;
      this.segments.delete(this.fastStartSentence); // rebuild it with the fast-start split
    }
    this.actor.send(e);
  }

  get state(): PlayerStateValue {
    return this.actor.getSnapshot().value as PlayerStateValue;
  }

  get snapshot(): SnapshotFrom<typeof playerMachine> {
    return this.actor.getSnapshot();
  }

  get cursor(): Cursor {
    return this.actor.getSnapshot().context.cursor;
  }

  /** The segment currently loaded in the backend. */
  get currentSegment(): PreparedSegment | undefined {
    return this.current;
  }

  stats(): PlayerStats {
    const rtf = this.rtfs.length ? this.rtfs.reduce((a, b) => a + b, 0) / this.rtfs.length : null;
    let ahead = 0;
    let c: Cursor | undefined = this.cursor;
    for (let i = 0; c && i < MAX_WINDOW; i++, c = this.nextCursor(c)) {
      const p = this.scheduler.peek(this.keyOf(c));
      if (!p) break;
      ahead += p.audio.duration * p.modelSpeed;
    }
    const cur = this.current;
    if (cur) ahead -= this.deps.backend.mediaTime() * cur.modelSpeed;
    return { rtf, ...this.counters, bufferAhead: Math.max(0, ahead) };
  }

  setSkipRules(rules: SkipRules, lexicon?: Lexicon): void {
    this.settings.skipRules = rules;
    if (lexicon) this.lexicon = lexicon;
    this.replan();
  }

  dispose(): void {
    clearTimeout(this.earlyDrift);
    this.stopWatchdog();
    this.scheduler.reset();
    this.unsubscribeBackend();
    this.deps.backend.stop();
    this.actor.stop();
  }

  // ── segments ────────────────────────────────────────────────────────────

  segmentsFor(sentence: number): SpokenSegment[] {
    const cached = this.segments.get(sentence);
    if (cached) return cached;
    const segs = sentenceSegments(this.nav, sentence, {
      pacing: this.settings.pacing,
      lexicon: this.lexicon,
      skipRules: this.settings.skipRules,
      maxChars: this.deps.engine.caps.maxChars,
      fastStart: sentence === this.fastStartSentence,
    });
    this.segments.set(sentence, segs);
    return segs;
  }

  private nextCursor(c: Cursor): Cursor | undefined {
    if (c.part + 1 < this.segmentsFor(c.sentence).length)
      return { sentence: c.sentence, part: c.part + 1, word: 0 };
    for (let s = c.sentence + 1; s < this.nav.length; s++)
      if (this.segmentsFor(s).length) return { sentence: s, part: 0, word: 0 };
    return undefined;
  }

  /** First speakable cursor at or after `sentence`. */
  private speakableFrom(sentence: number, word = 0): Cursor | undefined {
    for (let s = Math.max(0, sentence); s < this.nav.length; s++) {
      const segs = this.segmentsFor(s);
      if (!segs.length) continue;
      if (s !== sentence || word === 0) return { sentence: s, part: 0, word: 0 };
      // Click-to-read: pick the part that contains the word.
      const part = segs.findIndex((seg) => seg.words.some((w) => w.sentenceWord >= word));
      return { sentence: s, part: Math.max(0, part), word };
    }
    return undefined;
  }

  private resolveNav(e: NavEvent, c: Cursor): Cursor | undefined {
    const nav = this.nav;
    switch (e.type) {
      case 'SEEK':
        return this.speakableFrom(nav.clamp(e.sentence), e.word ?? 0);
      case 'NEXT_SENTENCE': {
        const n = nav.next(c.sentence);
        return n === undefined ? undefined : this.speakableFrom(n);
      }
      case 'PREV_SENTENCE': {
        // Within the first two seconds of a sentence, go to the previous one; else restart it.
        const t = this.deps.backend.mediaTime();
        const target =
          c.part === 0 && t > 2 && this.state === 'playing' ? c.sentence : nav.prev(c.sentence);
        return target === undefined ? undefined : this.speakableFrom(target);
      }
      case 'NEXT_BLOCK': {
        const n = nav.nextBlock(c.sentence);
        return n === undefined ? undefined : this.speakableFrom(n);
      }
      case 'PREV_BLOCK': {
        const n = nav.prevBlock(c.sentence);
        return n === undefined ? undefined : this.speakableFrom(n);
      }
    }
  }

  private keyOf(c: Cursor): string {
    return `${c.sentence}#${c.part}|${this.settings.voice}|${modelSpeedFor(this.settings.rate)}`;
  }

  private parseKey(key: string): { cursor: Cursor; voice: string; modelSpeed: number } {
    const [pos = '', voice = '', speed = '1'] = key.split('|');
    const [s = '0', p = '0'] = pos.split('#');
    return {
      cursor: { sentence: Number(s), part: Number(p), word: 0 },
      voice,
      modelSpeed: Number(speed),
    };
  }

  /**
   * Wanted set: the cursor's segment, then segments until ≥ 20 s of speech after it and ≥ 4
   * segments are covered. Prepared segments count their real duration; others are estimated.
   */
  private window(from: Cursor): Wanted[] {
    const out: Wanted[] = [];
    let seconds = 0;
    let c: Cursor | undefined = from;
    while (
      c &&
      out.length < MAX_WINDOW &&
      (seconds < PREFETCH_SECONDS || out.length < PREFETCH_SEGMENTS)
    ) {
      const seg = this.segmentsFor(c.sentence)[c.part];
      if (!seg) break;
      const key = this.keyOf(c);
      if (out.length) {
        const ready = this.scheduler.peek(key);
        seconds += ready
          ? ready.audio.duration * ready.modelSpeed
          : seg.spoken.length * SECONDS_PER_CHAR + seg.pauseAfter;
      }
      out.push({ key, distance: out.length });
      c = this.nextCursor(c);
    }
    return out;
  }

  // ── synthesis ───────────────────────────────────────────────────────────

  private async prepare(key: string, signal: AbortSignal): Promise<PreparedSegment> {
    const { cursor, voice, modelSpeed } = this.parseKey(key);
    const segment = this.segmentsFor(cursor.sentence)[cursor.part];
    if (!segment) throw new Error(`No segment at ${key}`);
    if (this.deps.engine.caps.live) return this.planLive(segment, voice);
    const r = await renderSegment(
      {
        engine: this.deps.engine,
        model: this.deps.model,
        cache: this.deps.cache,
        lang: this.deps.doc.lang,
        now: this.now,
      },
      segment,
      voice,
      modelSpeed,
      signal,
    );
    if (r.fromCache) this.counters.cacheHits++;
    if (r.synth) this.sampleRtf(r.synth.seconds, r.synth.audioSeconds);
    return {
      segment,
      audio: r.audio,
      sync: this.syncWords(segment, r.audio.words),
      modelSpeed,
      fromCache: r.fromCache,
    };
  }

  /** Rolling RTF for Diagnostics, and the "voice is too slow" suggestion (§6.4.4). */
  private sampleRtf(seconds: number, audioSeconds: number): void {
    this.counters.synthesized++;
    if (audioSeconds <= 0) return;
    const rtf = seconds / audioSeconds;
    this.rtfs.push(rtf);
    if (this.rtfs.length > RTF_SAMPLES) this.rtfs.shift();
    if (this.rtfMonitor.sample(rtf, this.now()) && !this.slowNoticeShown) {
      this.slowNoticeShown = true;
      this.deps.onNotice?.({ kind: 'info', message: SLOW_VOICE_NOTICE });
    }
  }

  /** Live engines speak by themselves: plan estimated timings for the clock and highlights. */
  private planLive(segment: SpokenSegment, voice: string): PreparedSegment {
    const speech = Math.max(0.3, segment.spoken.length * LIVE_SECONDS_PER_CHAR);
    const words = estimateTimings({
      spoken: segment.spoken,
      words: segment.words.map((w) => ({ start: w.spokenStart, end: w.spokenEnd })),
      voicedStart: 0,
      voicedEnd: speech,
    });
    const audio: ProcessedAudio = {
      pcm: new Float32Array(0),
      sampleRate: 24000,
      words,
      duration: speech + segment.pauseAfter,
      speechEnd: speech,
      utterance: { text: segment.spoken, voice, lang: this.deps.doc.lang },
    };
    return {
      segment,
      audio,
      sync: this.syncWords(segment, words),
      modelSpeed: 1,
      fromCache: false,
    };
  }

  /** Engine word timings (spoken offsets) → display ranges for highlighting. */
  private syncWords(segment: SpokenSegment, timings: WordTiming[]): SyncWord[] {
    const out: SyncWord[] = [];
    for (const t of timings) {
      const w = segment.words.find((x) => x.spokenEnd > t.charStart && x.spokenStart < t.charEnd);
      if (!w) continue;
      out.push({
        start: t.start,
        end: t.end,
        displayStart: w.displayStart,
        displayEnd: w.displayEnd,
        sentenceWord: w.sentenceWord,
      });
    }
    return out;
  }

  // ── machine actions ─────────────────────────────────────────────────────

  private requestSegment(c: Cursor): void {
    const token = ++this.requestToken;
    const target = this.segmentsFor(c.sentence).length ? c : this.speakableFrom(c.sentence);
    if (!target) {
      queueMicrotask(
        () =>
          token === this.requestToken &&
          this.actor.send({ type: 'SEGMENT_FAILED', message: NOTHING_TO_READ }),
      );
      return;
    }
    if (target.sentence !== c.sentence) {
      // The cursor sits on a sentence with nothing to say (e.g. only a citation): move past it.
      queueMicrotask(
        () =>
          token === this.requestToken &&
          this.actor.send({ type: 'SEEK', sentence: target.sentence }),
      );
      return;
    }
    this.scheduler.want(this.window(target));
    this.scheduler.get(this.keyOf(target)).then(
      () => token === this.requestToken && this.actor.send({ type: 'SEGMENT_READY' }),
      (e: unknown) => {
        if (token !== this.requestToken || isAbort(e)) return;
        this.counters.errors++;
        this.actor.send({
          type: 'SEGMENT_FAILED',
          message: e instanceof Error ? e.message : String(e),
        });
      },
    );
  }

  private playbackRate(): number {
    return this.deps.engine.caps.live
      ? this.settings.rate
      : this.settings.rate / modelSpeedFor(this.settings.rate);
  }

  private startAudio(c: Cursor, loaded: boolean): void {
    const backend = this.deps.backend;
    if (loaded && this.current) {
      backend.resume();
      return;
    }
    const prepared = this.scheduler.peek(this.keyOf(c));
    if (!prepared) {
      queueMicrotask(() => this.actor.send({ type: 'AUDIO_STALLED' }));
      return;
    }
    this.current = prepared;
    let offset = 0;
    if (c.word > 0) {
      const w = prepared.sync.find((x) => x.sentenceWord >= c.word);
      offset = Math.max(0, (w?.start ?? 0) - 0.05);
    }
    this.lastMediaTime = -1;
    this.lastProgressAt = this.now();
    backend.play(prepared.audio, { rate: this.playbackRate(), offset });
    const next = this.nextCursor(c);
    const upcoming = next && this.scheduler.peek(this.keyOf(next));
    if (upcoming) backend.preload(upcoming.audio);
    this.scheduler.want(this.window(c));
  }

  private pauseAudio(): void {
    this.deps.backend.pause();
    this.emit({
      type: 'PAUSED',
      sessionId: this.deps.sessionId,
      mediaTime: this.deps.backend.mediaTime(),
    });
  }

  private stopAudio(): void {
    this.deps.backend.stop();
    this.current = undefined;
    this.emit({ type: 'SEEKED', sessionId: this.deps.sessionId });
  }

  private applyRate(rate: number): void {
    const before = this.current?.modelSpeed ?? modelSpeedFor(rate);
    const playback = rate / before;
    this.deps.backend.setRate(playback);
    this.emit({
      type: 'RATE_CHANGED',
      sessionId: this.deps.sessionId,
      rate: playback,
      mediaTime: this.deps.backend.mediaTime(),
      atEpochMs: this.now(),
    });
    // Crossing 2× changes the model speed of upcoming segments.
    if (modelSpeedFor(rate) !== before && this.state === 'playing')
      this.scheduler.want(this.window(this.cursor));
  }

  private persist(c: Cursor): void {
    const pos = this.nav.position(c.sentence, c.word, this.now());
    if (!pos || pos.sentenceId === this.lastPersisted) return;
    this.lastPersisted = pos.sentenceId;
    this.deps.onPersist?.(pos);
  }

  private replan(): void {
    this.segments.clear();
    this.scheduler.reset();
  }

  // ── backend events, watchdog and drift ──────────────────────────────────

  private onBackend(e: BackendEvent): void {
    const cur = this.current;
    switch (e.type) {
      case 'started': {
        if (!cur) return;
        this.announced = cur;
        const ref: SentenceRef | undefined = this.nav.at(this.cursor.sentence);
        const rate = this.playbackRate();
        this.emit({
          type: 'SEGMENT_STARTED',
          sessionId: this.deps.sessionId,
          segmentId: cur.segment.id,
          sentenceId: cur.segment.sentenceId,
          blockId: cur.segment.blockId,
          sentenceIndex: ref?.index ?? this.cursor.sentence,
          words: cur.sync,
          mediaStartEpochMs: anchorFor(e.mediaTime, e.epochMs, rate),
          rate,
        });
        clearTimeout(this.earlyDrift);
        this.earlyDrift = setTimeout(() => {
          if (this.current !== cur || this.state !== 'playing') return;
          this.lastDriftAt = this.now();
          this.emit({
            type: 'DRIFT',
            sessionId: this.deps.sessionId,
            mediaTime: this.deps.backend.mediaTime(),
            atEpochMs: this.now(),
            settle: true,
          });
        }, EARLY_DRIFT_MS);
        break;
      }
      case 'ended':
        if (cur)
          this.emit({
            type: 'SEGMENT_ENDED',
            sessionId: this.deps.sessionId,
            segmentId: cur.segment.id,
          });
        this.current = undefined;
        this.stalls = 0;
        this.actor.send({ type: 'AUDIO_ENDED' });
        break;
      case 'progress':
        if (!cur || this.announced !== cur) break;
        this.emit({
          type: 'DRIFT',
          sessionId: this.deps.sessionId,
          mediaTime: e.mediaTime,
          atEpochMs: e.epochMs,
        });
        break;
      case 'error':
        this.counters.errors++;
        this.deps.onNotice?.({ kind: 'error', message: `Audio error: ${e.message}` });
        this.actor.send({ type: 'AUDIO_STALLED' });
        break;
    }
  }

  private startWatchdog(): void {
    if (this.watchdog) return;
    this.lastProgressAt = this.now();
    // Drift corrections keep their 2 s cadence across segment boundaries.
    if (!this.lastDriftAt) this.lastDriftAt = this.now();
    this.watchdog = setInterval(() => this.checkWatchdog(), WATCHDOG_MS);
  }

  private stopWatchdog(): void {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = undefined;
  }

  private checkWatchdog(): void {
    const now = this.now();
    const t = this.deps.backend.mediaTime();
    if (t !== this.lastMediaTime) {
      this.lastMediaTime = t;
      this.lastProgressAt = now;
    } else if (now - this.lastProgressAt >= STALL_MS) {
      this.stalls++;
      this.counters.stalls++;
      this.lastProgressAt = now;
      if (this.stalls >= STALLS_BEFORE_RESTART) {
        this.stalls = 0;
        this.deps.onNotice?.({
          kind: 'error',
          message: 'Playback kept stalling, so the voice was restarted.',
        });
        this.deps.onEngineRestart?.();
        this.scheduler.reset();
      }
      this.actor.send({ type: 'AUDIO_STALLED' });
      return;
    }
    if (now - this.lastDriftAt >= DRIFT_MS && this.current && this.announced === this.current) {
      this.lastDriftAt = now;
      this.emit({ type: 'DRIFT', sessionId: this.deps.sessionId, mediaTime: t, atEpochMs: now });
    }
  }

  private emit(e: SyncEvent): void {
    this.deps.onSync?.(e);
  }
}
