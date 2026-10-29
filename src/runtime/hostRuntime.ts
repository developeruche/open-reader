/**
 * Engine host runtime shared by the offscreen document (web mode) and the reader page (document
 * mode). Owns one Player at a time and reports status, sync and positions through a sink.
 */
import type { ReadingDocument } from '@/core/document/model';
import type { PlaybackBackend } from '@/core/player/backend';
import type { SynthesisCache } from '@/core/player/cache';
import { Player } from '@/core/player/player';
import type { RenderEngine } from '@/core/tts/engine';
import type { HostCommand, HostEvent, HostKind, HostStatus, SessionSettings } from './protocol';

export interface HostRuntimeDeps {
  kind: HostKind;
  backend: PlaybackBackend & { audibleCount?(): number };
  engineFor(
    settings: SessionSettings,
  ): Promise<{ engine: RenderEngine; model: { modelId: string; version: string } }>;
  cache?: SynthesisCache;
  emit(e: HostEvent): void;
  /** Drops the current engine so the next engineFor() starts a fresh worker. */
  resetEngine?(): void;
}

export class HostRuntime {
  player: Player | undefined;
  private sessionId: string | undefined;
  private doc: ReadingDocument | undefined;

  constructor(private readonly deps: HostRuntimeDeps) {}

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
      audible: this.deps.backend.audibleCount?.() ?? (p.state === 'playing' ? 1 : 0),
    };
  }

  async handle(cmd: HostCommand): Promise<void> {
    switch (cmd.type) {
      case 'LOAD':
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

  private async load(cmd: Extract<HostCommand, { type: 'LOAD' }>): Promise<void> {
    const token = ++this.loadToken;
    this.unload();
    this.lastSettings = cmd.settings;
    const { engine, model } = await this.deps.engineFor(cmd.settings);
    // A newer LOAD arrived while the engine was starting: it wins.
    if (token !== this.loadToken) return;
    this.sessionId = cmd.sessionId;
    this.doc = cmd.doc;
    const sessionId = cmd.sessionId;
    const player = new Player({
      doc: cmd.doc,
      engine,
      model,
      backend: this.deps.backend,
      sessionId,
      cache: this.deps.cache,
      settings: { rate: cmd.settings.rate, voice: cmd.settings.voice, pacing: cmd.settings.pacing },
      start: cmd.start,
      concurrency: engine.caps.backends.includes('webgpu') ? 1 : 2,
      onSync: (event) => this.deps.emit({ type: 'SYNC', event }),
      onPersist: (position) => this.deps.emit({ type: 'POSITION', position }),
      onNotice: (notice) => this.deps.emit({ type: 'NOTICE', sessionId, notice }),
      onEngineRestart: () => void this.restartEngine(),
    });
    this.player = player;
    let last = '';
    player.actor.subscribe(() => {
      const st = this.status();
      if (!st) return;
      const key = JSON.stringify([st.state, st.cursor, st.rate, st.voice, st.error]);
      if (key === last) return;
      last = key;
      this.deps.emit({ type: 'STATUS', status: st });
    });
    const st = this.status();
    if (st) this.deps.emit({ type: 'STATUS', status: st });
    if (cmd.autoplay) player.send({ type: 'PLAY' });
  }

  /** Watchdog asked for a restart (§9.2): new engine worker, same session and position. */
  async restartEngine(): Promise<void> {
    const p = this.player;
    const doc = this.doc;
    const sessionId = this.sessionId;
    if (!p || !doc || !sessionId) return;
    const c = p.snapshot.context;
    this.deps.resetEngine?.();
    await this.load({
      type: 'LOAD',
      sessionId,
      doc,
      start: { sentence: c.cursor.sentence, word: c.cursor.word },
      settings: { ...this.lastSettings, rate: c.rate, voice: c.voice, pacing: c.pacing },
      autoplay: true,
    });
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
