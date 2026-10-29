/**
 * Session orchestrator (PLAN.md §4.2): one active reading session at a time, routing between UI
 * surfaces, engine hosts and content scripts. Pure; chrome.* adapters are injected.
 */
import type { ReadingDocument, ReadingPosition } from '@/core/document/model';
import type { PlayerEvent } from '@/core/player/machine';
import { Navigator } from '@/core/document/positions';
import { DiagLog, type LogEntry } from '@/core/diagnostics/log';
import { applySkipRules, DEFAULT_SKIP_RULES } from '@/core/text/skip';
import type {
  ContentUpdate,
  HostCommand,
  HostEvent,
  HostKind,
  HostStats,
  HostStatus,
  SessionInfo,
  SessionSettings,
  TextPoint,
  UiCommand,
  UiUpdate,
} from './protocol';
import { DEFAULT_SESSION_SETTINGS } from './protocol';

export interface HostLink {
  send(cmd: HostCommand): void;
}

export interface SessionStore {
  loadSession(): Promise<SessionInfo | null>;
  saveSession(s: SessionInfo | null): Promise<void>;
  saveDoc(doc: ReadingDocument): Promise<void>;
  loadDoc(docId: string): Promise<ReadingDocument | undefined>;
}

export interface LibraryStore {
  savePosition(
    pos: ReadingPosition,
    meta: { title: string; url?: string; kind: ReadingDocument['kind'] },
  ): Promise<void>;
  getPosition(docId: string): Promise<ReadingPosition | undefined>;
}

export interface OrchestratorDeps {
  store: SessionStore;
  library: LibraryStore;
  offscreen: { ensure(): Promise<void>; exists(): Promise<boolean> };
  ui: { broadcast(u: UiUpdate): void };
  content: {
    send(tabId: number, u: ContentUpdate): void;
    extract(tabId: number, fromSelection: boolean, fromHere?: boolean): Promise<void>;
  };
  settings(): Promise<SessionSettings>;
  activeTabId(): Promise<number | undefined>;
  now(): number;
  newId(): string;
  debug?(e: DebugEvent): void;
}

export type DebugEvent =
  | { kind: 'status'; host: HostKind; status: HostStatus; at: number }
  | { kind: 'sync'; type: string; sentenceId?: string; at: number }
  | { kind: 'host'; host: HostKind; event: 'connected' | 'disconnected' | 'hello'; at: number }
  | { kind: 'command'; command: string; at: number };

/** What the Diagnostics page shows and copies (no document text, no title or URL). */
export interface DiagnosticsReport {
  session: Omit<SessionInfo, 'title' | 'url'> | null;
  stats: HostStats[];
  log: LogEntry[];
  droppedLogEntries: number;
}

export class Orchestrator {
  session: SessionInfo | null = null;
  readonly log = new DiagLog();
  private readonly stats = new Map<HostKind, HostStats>();
  private readonly links = new Map<HostKind, HostLink>();
  private readonly ready = new Set<HostKind>();
  private readonly pending = new Map<HostKind, HostCommand[]>();
  private readonly lastStatus = new Map<HostKind, HostStatus>();
  private restored: Promise<void>;

  constructor(private readonly deps: OrchestratorDeps) {
    this.restored = this.restore();
  }

  /** Reloads routing state after a service worker restart. */
  private async restore(): Promise<void> {
    this.session = await this.deps.store.loadSession();
  }

  whenRestored(): Promise<void> {
    return this.restored;
  }

  // ── hosts ───────────────────────────────────────────────────────────────

  diagnostics(): DiagnosticsReport {
    let session: DiagnosticsReport['session'] = null;
    if (this.session) {
      const { title: _t, url: _u, ...rest } = this.session;
      session = rest;
    }
    return {
      session,
      stats: [...this.stats.values()],
      log: this.log.entries(),
      droppedLogEntries: this.log.droppedCount,
    };
  }

  private note(level: LogEntry['level'], source: string, message: string, detail?: string): void {
    this.log.push({ at: this.deps.now(), level, source, message, ...(detail ? { detail } : {}) });
  }

  hostConnected(kind: HostKind, link: HostLink): void {
    this.links.set(kind, link);
    this.note('info', kind, 'host connected');
    this.deps.debug?.({ kind: 'host', host: kind, event: 'connected', at: this.deps.now() });
  }

  async hostDisconnected(kind: HostKind): Promise<void> {
    await this.restored;
    this.links.delete(kind);
    this.ready.delete(kind);
    this.lastStatus.delete(kind);
    this.stats.delete(kind);
    this.note('warn', kind, 'host disconnected');
    this.deps.debug?.({ kind: 'host', host: kind, event: 'disconnected', at: this.deps.now() });
    if (kind === 'offscreen' && this.session?.host === 'offscreen') {
      // The offscreen document closed (30 s rule, crash) or the port dropped; remember to rebuild.
      const gone = !(await this.deps.offscreen.exists());
      if (gone)
        await this.updateSession({
          hostLost: true,
          state: this.session.state === 'playing' ? 'paused' : this.session.state,
        });
    }
  }

  async hostEvent(kind: HostKind, e: HostEvent): Promise<void> {
    await this.restored;
    switch (e.type) {
      case 'HELLO':
        await this.onHello(kind, e.status);
        break;
      case 'STATUS':
        await this.onStatus(kind, e.status);
        break;
      case 'SYNC':
        this.deps.debug?.({
          kind: 'sync',
          type: e.event.type,
          sentenceId: e.event.type === 'SEGMENT_STARTED' ? e.event.sentenceId : undefined,
          at: this.deps.now(),
        });
        if (kind === 'offscreen' && this.session?.tabId !== undefined)
          this.deps.content.send(this.session.tabId, { type: 'SYNC', event: e.event });
        this.deps.ui.broadcast({ type: 'SYNC', event: e.event });
        break;
      case 'POSITION': {
        const s = this.session;
        if (kind === 'offscreen' && s && e.position.docId === s.docId) {
          await this.deps.library.savePosition(e.position, {
            title: s.title,
            url: s.url,
            kind: 'web',
          });
        } else if (kind === 'inpage') {
          await this.deps.library.savePosition(e.position, { title: '', kind: 'pdf' });
        }
        break;
      }
      case 'NOTICE':
        this.note(
          e.notice.kind === 'error' ? 'error' : 'info',
          kind,
          e.notice.message,
          e.notice.detail,
        );
        this.deps.ui.broadcast({ type: 'NOTICE', notice: e.notice });
        break;
      case 'STATS':
        this.stats.set(kind, e.stats);
        break;
    }
  }

  private async onHello(kind: HostKind, status: HostStatus | null): Promise<void> {
    this.ready.add(kind);
    this.deps.debug?.({ kind: 'host', host: kind, event: 'hello', at: this.deps.now() });
    const s = this.session;
    if (kind === 'offscreen' && s?.host === 'offscreen') {
      if (status?.sessionId === s.sessionId) {
        // Service worker restarted while the host kept playing: just resync.
        await this.onStatus(kind, status);
      } else if (
        (s.hostLost || !status) &&
        !(this.pending.get(kind) ?? []).some((c) => c.type === 'LOAD')
      ) {
        const autoplay = this.autoplayNext;
        this.autoplayNext = false;
        await this.loadIntoHost(s, autoplay);
      }
    }
    const queued = this.pending.get(kind) ?? [];
    this.pending.delete(kind);
    for (const cmd of queued) this.links.get(kind)?.send(cmd);
  }

  private async onStatus(kind: HostKind, status: HostStatus): Promise<void> {
    const previous = this.lastStatus.get(kind);
    this.lastStatus.set(kind, status);
    if (status.state !== previous?.state)
      this.note(
        status.state === 'error' ? 'error' : 'info',
        kind,
        `state ${status.state}${status.engine ? ` (${status.engine}${status.backend ? ` · ${status.backend}` : ''})` : ''}`,
        status.state === 'error' ? (status.error ?? undefined) : undefined,
      );
    this.deps.debug?.({ kind: 'status', host: kind, status, at: this.deps.now() });
    // Only one session may be audible: starting one pauses the other host (§4.2).
    if (status.state === 'playing' && previous?.state !== 'playing') {
      for (const [other, st] of this.lastStatus) {
        if (
          other !== kind &&
          (st.state === 'playing' ||
            st.state === 'buffering' ||
            st.state === 'preparing' ||
            st.state === 'seeking')
        ) {
          this.sendTo(other, { type: 'PLAYER', sessionId: st.sessionId, event: { type: 'PAUSE' } });
        }
      }
    }
    if (kind === 'offscreen' && this.session && status.sessionId === this.session.sessionId) {
      await this.updateSession({
        state: status.state,
        cursor: status.cursor,
        settings: { ...this.session.settings, rate: status.rate, voice: status.voice },
        sentenceCount: status.sentenceCount,
        error: status.error,
        hostLost: false,
        engine: status.engine,
        backend: status.backend,
      });
    }
  }

  private sendTo(kind: HostKind, cmd: HostCommand): void {
    const link = this.links.get(kind);
    if (link && this.ready.has(kind)) link.send(cmd);
    else this.pending.set(kind, [...(this.pending.get(kind) ?? []), cmd]);
  }

  private async loadIntoHost(s: SessionInfo, autoplay: boolean): Promise<void> {
    const doc = await this.deps.store.loadDoc(s.docId);
    if (!doc) {
      await this.updateSession({
        error: 'The document is no longer available. Open the page again.',
        hostLost: false,
      });
      return;
    }
    // Queue first: a freshly created host may say HELLO before ensure() returns.
    this.sendTo('offscreen', {
      type: 'LOAD',
      sessionId: s.sessionId,
      doc,
      start: { sentence: s.cursor.sentence, word: s.cursor.word },
      settings: s.settings,
      autoplay,
    });
    await this.deps.offscreen.ensure();
    await this.updateSession({ hostLost: false });
  }

  // ── UI commands ─────────────────────────────────────────────────────────

  async command(cmd: UiCommand): Promise<void> {
    await this.restored;
    this.deps.debug?.({ kind: 'command', command: cmd.type, at: this.deps.now() });
    this.note('info', 'ui', `command ${cmd.type}`);
    if (cmd.type === 'READ_TAB') {
      await this.deps.content.extract(cmd.tabId, cmd.fromSelection ?? false);
      return;
    }
    const s = this.session;
    if (!s) {
      if (cmd.type === 'PLAY' || cmd.type === 'TOGGLE') {
        const tabId = await this.deps.activeTabId();
        if (tabId !== undefined) await this.deps.content.extract(tabId, false);
      }
      return;
    }
    const event = cmd as PlayerEvent;
    if (s.host === 'offscreen') {
      const wantsPlay = cmd.type === 'PLAY' || (cmd.type === 'TOGGLE' && s.state !== 'playing');
      if (wantsPlay && (s.hostLost || !this.links.has('offscreen'))) {
        // Recreate the host and resume where we were (§9.2).
        await this.updateSession({ hostLost: true });
        if (this.ready.has('offscreen')) await this.loadIntoHost(this.session ?? s, true);
        else {
          // The recreated host loads the session on HELLO, then plays.
          this.autoplayNext = true;
          await this.deps.offscreen.ensure();
        }
        return;
      }
      this.sendTo('offscreen', { type: 'PLAYER', sessionId: s.sessionId, event });
    }
  }

  /** PLAY arrived while the host was gone: play as soon as the recreated host has loaded. */
  private autoplayNext = false;

  /** Context menu entries: read the selection, or the page from where it was right-clicked. */
  async readTab(tabId: number, o: { fromSelection: boolean; fromHere: boolean }): Promise<void> {
    await this.restored;
    this.deps.debug?.({ kind: 'command', command: 'READ_TAB', at: this.deps.now() });
    await this.deps.content.extract(tabId, o.fromSelection, o.fromHere);
  }

  /** chrome.commands (§4.5): toggle-play, next-sentence, prev-sentence. */
  async keyboardCommand(name: string): Promise<void> {
    const map: Record<string, UiCommand> = {
      'toggle-play': { type: 'TOGGLE' },
      'next-sentence': { type: 'NEXT_SENTENCE' },
      'prev-sentence': { type: 'PREV_SENTENCE' },
    };
    const cmd = map[name];
    if (cmd) await this.command(cmd);
  }

  // ── content ─────────────────────────────────────────────────────────────

  /** A content script extracted a document: start (or resume) a web-mode session. */
  async contentDoc(
    tabId: number,
    raw: ReadingDocument,
    url: string,
    startAt?: TextPoint,
  ): Promise<void> {
    await this.restored;
    const settings = await this.deps.settings();
    const rules = settings.skipRules ?? DEFAULT_SKIP_RULES;
    // Reading rules decide which blocks are spoken, and so the sentence numbering.
    const doc: ReadingDocument = { ...raw, blocks: applySkipRules(raw.blocks, rules) };
    const nav = new Navigator(doc, { announceSkippedCode: rules.announceSkippedCode });
    let start = 0;
    let word = 0;
    if (startAt) {
      start = nav.sentenceAtOffset(startAt.blockId, startAt.offset) ?? 0;
      word = nav.wordAtOffset(start, startAt.offset);
    } else {
      const saved = await this.deps.library.getPosition(doc.id);
      if (saved) {
        const r = new Navigator(doc).resolve(saved);
        start = r.index;
        word = r.word;
      }
    }
    const previous = this.session;
    if (previous && previous.host === 'offscreen')
      this.sendTo('offscreen', { type: 'UNLOAD', sessionId: previous.sessionId });

    const session: SessionInfo = {
      sessionId: this.deps.newId(),
      docId: doc.id,
      title: doc.title,
      host: 'offscreen',
      tabId,
      url,
      state: 'preparing',
      cursor: { sentence: start, part: 0, word },
      settings,
      sentenceCount: nav.length,
      hostLost: false,
      error: null,
      updatedAt: this.deps.now(),
    };
    await this.deps.store.saveDoc(doc);
    const previousTab = this.session?.tabId;
    this.session = session;
    await this.deps.store.saveSession(session);
    this.deps.ui.broadcast({ type: 'SESSION', session });
    this.deps.ui.broadcast({ type: 'DOC', doc });
    this.notifyContent(previousTab);
    this.sendTo('offscreen', {
      type: 'LOAD',
      sessionId: session.sessionId,
      doc,
      start: { sentence: start, word },
      settings,
      autoplay: true,
    });
    await this.deps.offscreen.ensure();
  }

  private async updateSession(patch: Partial<SessionInfo>): Promise<void> {
    if (!this.session) return;
    const before = this.session;
    this.session = { ...this.session, ...patch, updatedAt: this.deps.now() };
    await this.deps.store.saveSession(this.session);
    this.deps.ui.broadcast({ type: 'SESSION', session: this.session });
    if (before.state !== this.session.state || before.settings.rate !== this.session.settings.rate)
      this.notifyContent();
  }

  /** Tells the session's tab what is playing (mini player, keyboard shortcuts). */
  private notifyContent(previousTab?: number): void {
    const s = this.session;
    if (previousTab !== undefined && previousTab !== s?.tabId) {
      this.deps.content.send(previousTab, {
        type: 'SESSION',
        session: { active: false, docId: null, state: null, rate: 1 },
      });
    }
    if (s?.tabId !== undefined) {
      this.deps.content.send(s.tabId, {
        type: 'SESSION',
        session: { active: true, docId: s.docId, state: s.state, rate: s.settings.rate },
      });
    }
  }

  /** The document of the current session, for the side panel's reader view. */
  async currentDoc(): Promise<ReadingDocument | undefined> {
    await this.restored;
    return this.session ? this.deps.store.loadDoc(this.session.docId) : undefined;
  }

  /** Click-to-read from the page: seek within the session, or start reading this document there. */
  async contentSeek(tabId: number, docId: string, at: TextPoint): Promise<boolean> {
    await this.restored;
    const s = this.session;
    if (!s || s.docId !== docId || s.tabId !== tabId) return false;
    const doc = await this.deps.store.loadDoc(docId);
    if (!doc) return false;
    const nav = new Navigator(doc, {
      announceSkippedCode: (s.settings.skipRules ?? DEFAULT_SKIP_RULES).announceSkippedCode,
    });
    const sentence = nav.sentenceAtOffset(at.blockId, at.offset);
    if (sentence === undefined) return false;
    await this.command({ type: 'SEEK', sentence, word: nav.wordAtOffset(sentence, at.offset) });
    if (s.state !== 'playing') await this.command({ type: 'PLAY' });
    return true;
  }

  defaultSettings(): SessionSettings {
    return DEFAULT_SESSION_SETTINGS;
  }
}
