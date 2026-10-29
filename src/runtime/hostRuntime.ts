/**
 * Engine host runtime shared by the offscreen document (web mode) and the reader page (document
 * mode). Owns one Player at a time and reports status, sync and positions through a sink.
 */
import type { ReadingDocument } from '@/core/document/model';
import type { PlaybackBackend } from '@/core/player/backend';
import type { SynthesisCache } from '@/core/player/cache';
import { NOTHING_TO_READ, Player } from '@/core/player/player';
import { switchMessage, type EngineChoice } from '@/core/tts/fallback';
import { isAbort, serialized } from '@/core/tts/engine';
import { lexiconFrom } from '@/core/text/lexicon';
import { DEFAULT_SKIP_RULES } from '@/core/text/skip';
import { runExport, type ExportStore, type Mp3Encoder } from './export';
import type { RenderEngine } from '@/core/tts/engine';
import type {
  HostCommand,
  HostEvent,
  HostKind,
  HostStats,
  HostStatus,
  ExportStatus,
  SessionSettings,
} from './protocol';

export const STATS_MS = 1000;
/** An engine worker idle this long is released (≈ 1 GB for Kokoro on WebGPU, ADR 0017). */
export const IDLE_RELEASE_MS = 5 * 60_000;
const ACTIVE_STATES = new Set(['preparing', 'buffering', 'playing', 'seeking', 'retrying']);

export interface HostRuntimeDeps {
  kind: HostKind;
  backend: PlaybackBackend & { audibleCount?(): number };
  /** Backend for live engines (system voices via chrome.tts). */
  liveBackend?: PlaybackBackend & { audibleCount?(): number };
  engineFor(
    settings: SessionSettings,
  ): Promise<{ engine: RenderEngine; model: { modelId: string; version: string } }>;
  cache?: SynthesisCache;
  emit(e: HostEvent): void;
  /** Drops the current engine so the next engineFor() starts a fresh worker. */
  resetEngine?(): void;
  now?(): number;
  /** Override IDLE_RELEASE_MS (tests). */
  idleReleaseMs?: number;
  /** Audiobook export (absent: the host cannot export). */
  exporter?: {
    store: ExportStore;
    mp3(sampleRate: number, kbps: number): Promise<Mp3Encoder>;
    /** A URL the background can download (blob: URL of the output file). */
    url(path: string): Promise<string>;
    release(url: string, path: string): Promise<void>;
  };
}

export class HostRuntime {
  player: Player | undefined;
  private activeBackend: HostRuntimeDeps['backend'];
  private engineLabel: { engine: string; backend: string } | undefined;
  private sessionId: string | undefined;
  private doc: ReadingDocument | undefined;
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private counts = { fallbacks: 0, engineRestarts: 0 };
  private idleTimer: ReturnType<typeof setTimeout> | undefined;
  /** The engine was released while idle: the next player command reloads it first. */
  private released = false;
  /** The LOAD in flight, so an EXPORT sent right after it waits for the engine. */
  private loading: Promise<void> = Promise.resolve();
  private engine: RenderEngine | undefined;
  private model: { modelId: string; version: string } | undefined;
  private job: { jobId: string; ac: AbortController; url?: string; path?: string } | undefined;

  constructor(private readonly deps: HostRuntimeDeps) {
    this.activeBackend = deps.backend;
  }

  hello(): void {
    this.deps.emit({ type: 'HELLO', host: this.deps.kind, status: this.status() });
  }

  status(): HostStatus | null {
    const p = this.player;
    if (!p || !this.sessionId) return null;
    const s = p.snapshot;
    return {
      sessionId: this.sessionId,
      state: p.state,
      cursor: s.context.cursor,
      rate: s.context.rate,
      voice: s.context.voice,
      sentenceCount: p.nav.length,
      error: s.context.error?.message ?? null,
      audible: this.activeBackend.audibleCount?.() ?? (p.state === 'playing' ? 1 : 0),
      engine: this.engineLabel?.engine,
      backend: this.engineLabel?.backend,
    };
  }

  stats(): HostStats | null {
    const p = this.player;
    if (!p || !this.sessionId) return null;
    return {
      ...p.stats(),
      ...this.counts,
      sessionId: this.sessionId,
      host: this.deps.kind,
      engine: this.engineLabel?.engine ?? '',
      backend: this.engineLabel?.backend ?? '',
      state: p.state,
      at: (this.deps.now ?? Date.now)(),
    };
  }

  async handle(cmd: HostCommand): Promise<void> {
    switch (cmd.type) {
      case 'LOAD':
        if (cmd.sessionId !== this.sessionId) this.counts = { fallbacks: 0, engineRestarts: 0 };
        this.loading = this.load(cmd);
        await this.loading;
        break;
      case 'PLAYER':
        if (cmd.sessionId !== this.sessionId) break;
        if (this.released) await this.reacquire();
        this.player?.send(cmd.event);
        break;
      case 'SET_LEXICON':
        if (cmd.sessionId !== this.sessionId || !this.player || !this.engine) break;
        this.lastSettings = { ...this.lastSettings, lexicon: cmd.lexicon };
        this.player.setSkipRules(
          this.lastSettings.skipRules ?? DEFAULT_SKIP_RULES,
          lexiconFrom(cmd.lexicon, this.engine.id),
        );
        break;
      case 'EXPORT':
        void this.startExport(cmd);
        break;
      case 'EXPORT_CANCEL':
        if (this.job?.jobId === cmd.jobId) this.job.ac.abort();
        break;
      case 'EXPORT_RELEASE': {
        const j = this.job;
        if (j?.jobId === cmd.jobId && j.url && j.path)
          void this.deps.exporter?.release(j.url, j.path);
        if (j?.jobId === cmd.jobId) this.job = undefined;
        break;
      }
      case 'UNLOAD':
        if (cmd.sessionId === this.sessionId) this.unload();
        break;
    }
  }

  get currentDoc(): ReadingDocument | undefined {
    return this.doc;
  }

  private loadToken = 0;

  private async load(
    cmd: Extract<HostCommand, { type: 'LOAD' }>,
    failed?: { from: EngineChoice; error: string },
  ): Promise<void> {
    const token = ++this.loadToken;
    this.unload();
    if (cmd.settings.cacheCapBytes) void this.deps.cache?.setCap?.(cmd.settings.cacheCapBytes);
    let settings = cmd.settings;
    let opened: Awaited<ReturnType<HostRuntimeDeps['engineFor']>>;
    try {
      ({ opened, settings } = await this.openWithFallback(cmd, token, failed));
    } catch (e) {
      if (token !== this.loadToken) return;
      // Never fail silently (§1): report a visible error the user can act on.
      const message = `The voice could not start: ${e instanceof Error ? e.message : String(e)}. Open Settings → Voices & models.`;
      this.deps.emit({
        type: 'NOTICE',
        sessionId: cmd.sessionId,
        notice: { kind: 'error', message },
      });
      this.deps.emit({
        type: 'STATUS',
        status: {
          sessionId: cmd.sessionId,
          state: 'error',
          cursor: { sentence: cmd.start.sentence, part: 0, word: cmd.start.word },
          rate: cmd.settings.rate,
          voice: cmd.settings.voice,
          sentenceCount: 0,
          error: message,
          audible: 0,
        },
      });
      return;
    }
    this.lastSettings = settings;
    const { model } = opened;
    const engine = serialized(opened.engine);
    this.engineLabel = {
      engine: engine.id,
      backend: (opened as { backend?: string }).backend ?? '',
    };
    // A newer LOAD arrived while the engine was starting: it wins.
    if (token !== this.loadToken) return;
    this.sessionId = cmd.sessionId;
    this.doc = cmd.doc;
    this.engine = engine;
    this.model = model;
    const sessionId = cmd.sessionId;
    this.activeBackend =
      engine.caps.live && this.deps.liveBackend ? this.deps.liveBackend : this.deps.backend;
    const player = new Player({
      doc: cmd.doc,
      engine,
      model,
      backend: this.activeBackend,
      sessionId,
      cache: this.deps.cache,
      settings: {
        rate: settings.rate,
        voice: settings.voice,
        pacing: settings.pacing,
        ...(settings.skipRules ? { skipRules: settings.skipRules } : {}),
        lexicon: lexiconFrom(settings.lexicon, engine.id),
      },
      start: cmd.start,
      concurrency: engine.caps.backends.includes('webgpu') ? 1 : 2,
      onSync: (event) => this.deps.emit({ type: 'SYNC', event }),
      onPersist: (position) => this.deps.emit({ type: 'POSITION', position }),
      onNotice: (notice) => this.deps.emit({ type: 'NOTICE', sessionId, notice }),
      onEngineRestart: () => void this.restartEngine(),
    });
    this.player = player;
    this.startStats();
    let last = '';
    player.actor.subscribe(() => {
      const st = this.status();
      if (!st) return;
      if (st.state === 'error' && st.error !== NOTHING_TO_READ && this.player === player)
        if (this.fallBack(st.error ?? 'Playback failed')) return;
      if (this.player === player) this.watchIdle(st.state);
      const key = JSON.stringify([st.state, st.cursor, st.rate, st.voice, st.error]);
      if (key === last) return;
      last = key;
      this.deps.emit({ type: 'STATUS', status: st });
    });
    this.released = false;
    const st = this.status();
    if (st) this.deps.emit({ type: 'STATUS', status: st });
    if (st) this.watchIdle(st.state);
    if (cmd.autoplay) player.send({ type: 'PLAY' });
  }

  get engineReleased(): boolean {
    return this.released;
  }

  /** Starts the idle countdown when playback stops, cancels it when playback resumes. */
  private watchIdle(state: string): void {
    if (ACTIVE_STATES.has(state)) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
      return;
    }
    if (this.idleTimer || this.released) return;
    this.idleTimer = setTimeout(() => {
      this.idleTimer = undefined;
      if (!this.player || ACTIVE_STATES.has(this.player.state) || this.job) return;
      // The player keeps its position; only the worker (model, WASM heap, GPU buffers) goes.
      this.deps.resetEngine?.();
      this.released = true;
    }, this.deps.idleReleaseMs ?? IDLE_RELEASE_MS);
  }

  /** Reloads a released engine at the player's position, paused, before a command runs. */
  private async reacquire(): Promise<void> {
    const p = this.player;
    const doc = this.doc;
    const sessionId = this.sessionId;
    if (!p || !doc || !sessionId) return;
    const c = p.snapshot.context;
    await this.load({
      type: 'LOAD',
      sessionId,
      doc,
      start: { sentence: c.cursor.sentence, word: c.cursor.word },
      settings: { ...this.lastSettings, rate: c.rate, voice: c.voice, pacing: c.pacing },
      autoplay: false,
    });
  }

  /**
   * Tries the session's engine (twice: a retry on the same backend), then each fallback rung.
   * Returns the settings that worked, with the remaining rungs as its fallbacks.
   */
  private async openWithFallback(
    cmd: Extract<HostCommand, { type: 'LOAD' }>,
    token: number,
    failed?: { from: EngineChoice; error: string },
  ): Promise<{
    opened: Awaited<ReturnType<HostRuntimeDeps['engineFor']>>;
    settings: SessionSettings;
  }> {
    const primary = cmd.settings;
    const rungs = primary.fallbacks ?? [];
    let lastError: unknown;
    let from: EngineChoice = failed?.from ?? primary;
    for (let i = -1; i < rungs.length; i++) {
      const rung = i < 0 ? undefined : rungs[i];
      const settings: SessionSettings = rung
        ? {
            ...primary,
            engineId: rung.engineId,
            modelId: rung.modelId,
            backend: rung.backend,
            voice: rung.voice ?? primary.voice,
            fallbacks: rungs.slice(i + 1),
          }
        : primary;
      for (let attempt = 0; attempt < (rung ? 1 : 2); attempt++) {
        if (token !== this.loadToken) throw new Error('superseded');
        try {
          if (attempt > 0) this.deps.resetEngine?.();
          const opened = await this.deps.engineFor(settings);
          const switched = rung !== undefined || failed !== undefined;
          if (switched && token === this.loadToken) {
            this.counts.fallbacks++;
            this.deps.emit({
              type: 'NOTICE',
              sessionId: cmd.sessionId,
              notice: {
                kind: 'info',
                message: switchMessage(from, settings),
                detail: failed?.error ?? errorText(lastError),
              },
            });
          }
          return { opened, settings };
        } catch (e) {
          lastError = e;
          from = settings;
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error(errorText(lastError));
  }

  /** Playback failed after the player's own retries: move down the ladder (§9.2). */
  private fallBack(error: string): boolean {
    const p = this.player;
    const doc = this.doc;
    const sessionId = this.sessionId;
    const [next, ...rest] = this.lastSettings.fallbacks ?? [];
    if (!p || !doc || !sessionId || !next) return false;
    const c = p.snapshot.context;
    const from: EngineChoice = {
      engineId: this.lastSettings.engineId,
      modelId: this.lastSettings.modelId,
      backend:
        this.engineLabel?.backend === 'webgpu' || this.engineLabel?.backend === 'wasm'
          ? this.engineLabel.backend
          : this.lastSettings.backend,
    };
    this.deps.resetEngine?.();
    void this.load(
      {
        type: 'LOAD',
        sessionId,
        doc,
        start: { sentence: c.cursor.sentence, word: c.cursor.word },
        settings: {
          ...this.lastSettings,
          engineId: next.engineId,
          modelId: next.modelId,
          backend: next.backend,
          voice: next.voice ?? c.voice,
          rate: c.rate,
          pacing: c.pacing,
          fallbacks: rest,
        },
        autoplay: true,
      },
      { from, error },
    );
    return true;
  }

  /** Renders the current document to an audiobook (ADR 0019); the background downloads it. */
  private async startExport(cmd: Extract<HostCommand, { type: 'EXPORT' }>): Promise<void> {
    const status = (s: Partial<ExportStatus> & Pick<ExportStatus, 'state'>, url?: string) =>
      this.deps.emit({
        type: 'EXPORT',
        status: { jobId: cmd.jobId, format: cmd.format, phase: 'render', fraction: 0, ...s },
        ...(url ? { url } : {}),
      });
    // Register first, so a cancel that arrives while the engine is still loading is not lost.
    if (this.job) this.job.ac.abort();
    const ac = new AbortController();
    const job: NonNullable<HostRuntime['job']> = { jobId: cmd.jobId, ac };
    this.job = job;
    await this.loading.catch(() => undefined);
    const ex = this.deps.exporter;
    const p = this.player;
    const doc = this.doc;
    if (this.released) await this.reacquire();
    const engine = this.engine;
    const model = this.model;
    const fail = (message: string) => {
      if (this.job === job) this.job = undefined;
      status({ state: 'error', message });
    };
    if (ac.signal.aborted) {
      if (this.job === job) this.job = undefined;
      return status({ state: 'cancelled' });
    }
    if (!ex || !p || !doc || !engine || !model || cmd.sessionId !== this.sessionId)
      return fail('Open the document and start reading it first.');
    if (engine.caps.live)
      return fail("System voices can't be saved as audio. Choose an on-device voice to export.");
    const c = p.snapshot.context;
    let last = 0;
    try {
      const r = await runExport(
        {
          jobId: cmd.jobId,
          doc,
          format: cmd.format,
          voice: c.voice,
          pacing: c.pacing,
          skipRules: this.lastSettings.skipRules ?? DEFAULT_SKIP_RULES,
          lexicon: lexiconFrom(this.lastSettings.lexicon, engine.id),
          artist: cmd.artist,
        },
        {
          render: {
            engine,
            model,
            cache: this.deps.cache,
            lang: doc.lang,
            now: this.deps.now ?? Date.now,
          },
          store: ex.store,
          mp3: ex.mp3,
          onProgress: (pr) => {
            // Rendering is most of the work; encoding is the last tenth.
            const fraction =
              pr.phase === 'render' ? 0.9 * (pr.done / pr.total) : 0.9 + 0.1 * (pr.done / pr.total);
            if (fraction - last < 0.01 && pr.done !== pr.total) return;
            last = fraction;
            status({ state: 'running', phase: pr.phase, fraction });
          },
        },
        ac.signal,
      );
      job.path = r.path;
      job.url = await ex.url(r.path);
      status({ state: 'done', phase: 'encode', fraction: 1, filename: r.filename }, job.url);
    } catch (e) {
      if (this.job === job) this.job = undefined;
      if (isAbort(e)) status({ state: 'cancelled' });
      else status({ state: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }

  private startStats(): void {
    if (this.statsTimer) return;
    this.statsTimer = setInterval(() => {
      const st = this.stats();
      if (st) this.deps.emit({ type: 'STATS', stats: st });
    }, STATS_MS);
  }

  /** Watchdog asked for a restart (§9.2): new engine worker, same session and position. */
  async restartEngine(): Promise<void> {
    const p = this.player;
    const doc = this.doc;
    const sessionId = this.sessionId;
    if (!p || !doc || !sessionId) return;
    const c = p.snapshot.context;
    this.deps.resetEngine?.();
    this.counts.engineRestarts++;
    await this.load({
      type: 'LOAD',
      sessionId,
      doc,
      start: { sentence: c.cursor.sentence, word: c.cursor.word },
      settings: { ...this.lastSettings, rate: c.rate, voice: c.voice, pacing: c.pacing },
      autoplay: true,
    });
  }

  dispose(): void {
    clearTimeout(this.idleTimer);
    this.unload();
    if (this.statsTimer) clearInterval(this.statsTimer);
    this.statsTimer = undefined;
  }

  private lastSettings: SessionSettings = {
    rate: 1,
    voice: 'test',
    pacing: 'natural',
    engineId: 'test',
  };

  private unload(): void {
    clearTimeout(this.idleTimer);
    this.idleTimer = undefined;
    this.player?.dispose();
    this.player = undefined;
    this.sessionId = undefined;
    this.doc = undefined;
    this.engine = undefined;
    this.model = undefined;
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : e === undefined ? '' : String(e);
}
