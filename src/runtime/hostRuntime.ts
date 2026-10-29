/**
 * Engine host runtime shared by the offscreen document (web mode) and the reader page (document
 * mode). Owns one Player at a time and reports status, sync and positions through a sink.
 */
import type { ReadingDocument } from '@/core/document/model';
import type { PlaybackBackend } from '@/core/player/backend';
import type { SynthesisCache } from '@/core/player/cache';
import { NOTHING_TO_READ, Player } from '@/core/player/player';
import { switchMessage, type EngineChoice } from '@/core/tts/fallback';
import type { RenderEngine } from '@/core/tts/engine';
import type {
  HostCommand,
  HostEvent,
  HostKind,
  HostStats,
  HostStatus,
  SessionSettings,
} from './protocol';

export const STATS_MS = 1000;

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
}

export class HostRuntime {
  player: Player | undefined;
  private activeBackend: HostRuntimeDeps['backend'];
  private engineLabel: { engine: string; backend: string } | undefined;
  private sessionId: string | undefined;
  private doc: ReadingDocument | undefined;
  private statsTimer: ReturnType<typeof setInterval> | undefined;
  private counts = { fallbacks: 0, engineRestarts: 0 };

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
        await this.load(cmd);
        break;
      case 'PLAYER':
        if (cmd.sessionId === this.sessionId) this.player?.send(cmd.event);
        break;
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
    const { engine, model } = opened;
    this.engineLabel = {
      engine: engine.id,
      backend: (opened as { backend?: string }).backend ?? '',
    };
    // A newer LOAD arrived while the engine was starting: it wins.
    if (token !== this.loadToken) return;
    this.sessionId = cmd.sessionId;
    this.doc = cmd.doc;
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
      const key = JSON.stringify([st.state, st.cursor, st.rate, st.voice, st.error]);
      if (key === last) return;
      last = key;
      this.deps.emit({ type: 'STATUS', status: st });
    });
    const st = this.status();
    if (st) this.deps.emit({ type: 'STATUS', status: st });
    if (cmd.autoplay) player.send({ type: 'PLAY' });
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
    this.player?.dispose();
    this.player = undefined;
    this.sessionId = undefined;
    this.doc = undefined;
  }
}

function errorText(e: unknown): string {
  return e instanceof Error ? e.message : e === undefined ? '' : String(e);
}
