import { describe, expect, it } from 'vitest';
import { buildBlock } from '@/core/document/build';
import type { ReadingDocument, ReadingPosition } from '@/core/document/model';
import {
  Orchestrator,
  type DebugEvent,
  type LibraryStore,
  type SessionStore,
} from '@/runtime/orchestrator';
import {
  DEFAULT_SESSION_SETTINGS,
  parseUiCommand,
  type ContentUpdate,
  type HostCommand,
  type HostStatus,
  type SessionInfo,
  type UiUpdate,
} from '@/runtime/protocol';

const doc: ReadingDocument = {
  id: 'd1',
  kind: 'web',
  title: 'Doc',
  lang: 'en',
  blocks: [buildBlock({ id: 'p', type: 'paragraph', text: 'One. Two. Three. Four.' })],
};

function setup(opts: { stored?: SessionInfo | null; saved?: ReadingPosition } = {}) {
  const sessions: (SessionInfo | null)[] = [];
  let stored = opts.stored ?? null;
  const docs = new Map<string, ReadingDocument>();
  const store: SessionStore = {
    loadSession: async () => stored,
    saveSession: async (s) => {
      stored = s;
      sessions.push(s);
    },
    saveDoc: async (d) => void docs.set(d.id, d),
    loadDoc: async (id) => docs.get(id),
  };
  const positions: ReadingPosition[] = [];
  const library: LibraryStore = {
    savePosition: async (p) => void positions.push(p),
    getPosition: async () => opts.saved,
  };
  let offscreen = false;
  let ensures = 0;
  const ui: UiUpdate[] = [];
  const content: [number, ContentUpdate | 'extract'][] = [];
  const debug: DebugEvent[] = [];
  const orch = new Orchestrator({
    store,
    library,
    offscreen: {
      ensure: async () => {
        ensures++;
        offscreen = true;
      },
      exists: async () => offscreen,
    },
    ui: { broadcast: (u) => ui.push(u) },
    content: {
      send: (t, u) => void content.push([t, u]),
      extract: async (t) => void content.push([t, 'extract']),
    },
    settings: async () => DEFAULT_SESSION_SETTINGS,
    activeTabId: async () => 7,
    now: () => 1000,
    newId: () => `s${sessions.length}`,
    debug: (e) => debug.push(e),
  });
  const sent: { offscreen: HostCommand[]; inpage: HostCommand[] } = { offscreen: [], inpage: [] };
  const connect = (kind: 'offscreen' | 'inpage') =>
    orch.hostConnected(kind, { send: (c) => void sent[kind].push(c) });
  const status = (sessionId: string, state: HostStatus['state'], sentence = 0): HostStatus => ({
    sessionId,
    state,
    cursor: { sentence, part: 0, word: 0 },
    rate: 1,
    voice: 'test',
    sentenceCount: 4,
    error: null,
    audible: state === 'playing' ? 1 : 0,
  });
  return {
    orch,
    sent,
    connect,
    status,
    ui,
    content,
    positions,
    debug,
    docs,
    get ensures() {
      return ensures;
    },
    setOffscreen: (v: boolean) => (offscreen = v),
  };
}

describe('Orchestrator', () => {
  it('starts a web session from a content document and loads it once the host says hello', async () => {
    const h = setup();
    await h.orch.contentDoc(7, doc, 'https://x.test/a', undefined);
    expect(h.orch.session).toMatchObject({
      docId: 'd1',
      host: 'offscreen',
      tabId: 7,
      sentenceCount: 4,
      state: 'preparing',
    });
    expect(h.ensures).toBe(1);
    h.connect('offscreen');
    expect(h.sent.offscreen).toHaveLength(0);
    await h.orch.hostEvent('offscreen', { type: 'HELLO', host: 'offscreen', status: null });
    expect(h.sent.offscreen.map((c) => c.type)).toEqual(['LOAD']);
    expect(h.sent.offscreen[0]).toMatchObject({ autoplay: true, start: { sentence: 0, word: 0 } });
  });

  it('resumes a document from its saved position', async () => {
    const h = setup({ saved: { docId: 'd1', sentenceId: 'p.2', word: 1, updatedAt: 1 } });
    h.connect('offscreen');
    await h.orch.hostEvent('offscreen', { type: 'HELLO', host: 'offscreen', status: null });
    await h.orch.contentDoc(7, doc, 'https://x.test/a', undefined);
    expect(h.sent.offscreen.at(-1)).toMatchObject({
      type: 'LOAD',
      start: { sentence: 2, word: 1 },
    });
  });

  it('forwards player commands, status, sync and positions', async () => {
    const h = setup();
    h.connect('offscreen');
    await h.orch.hostEvent('offscreen', { type: 'HELLO', host: 'offscreen', status: null });
    await h.orch.contentDoc(7, doc, 'https://x.test/a', undefined);
    const id = h.orch.session!.sessionId;
    await h.orch.command({ type: 'PAUSE' });
    expect(h.sent.offscreen.at(-1)).toEqual({
      type: 'PLAYER',
      sessionId: id,
      event: { type: 'PAUSE' },
    });
    await h.orch.hostEvent('offscreen', { type: 'STATUS', status: h.status(id, 'playing', 2) });
    expect(h.orch.session).toMatchObject({ state: 'playing', cursor: { sentence: 2 } });
    await h.orch.hostEvent('offscreen', {
      type: 'SYNC',
      event: { type: 'PAUSED', sessionId: id, mediaTime: 1 },
    });
    expect(h.content.at(-1)).toEqual([
      7,
      { type: 'SYNC', event: { type: 'PAUSED', sessionId: id, mediaTime: 1 } },
    ]);
    expect(h.ui.some((u) => u.type === 'SYNC')).toBe(true);
    await h.orch.hostEvent('offscreen', {
      type: 'POSITION',
      position: { docId: 'd1', sentenceId: 'p.2', word: 0, updatedAt: 5 },
    });
    expect(h.positions).toHaveLength(1);
    await h.orch.hostEvent('offscreen', {
      type: 'NOTICE',
      sessionId: id,
      notice: { kind: 'error', message: 'x' },
    });
    expect(h.ui.at(-1)).toEqual({ type: 'NOTICE', notice: { kind: 'error', message: 'x' } });
  });

  it('marks the host lost when the offscreen document closes and recreates it on PLAY', async () => {
    const h = setup();
    h.connect('offscreen');
    await h.orch.hostEvent('offscreen', { type: 'HELLO', host: 'offscreen', status: null });
    await h.orch.contentDoc(7, doc, 'https://x.test/a', undefined);
    const id = h.orch.session!.sessionId;
    await h.orch.hostEvent('offscreen', { type: 'STATUS', status: h.status(id, 'paused', 3) });
    h.setOffscreen(false);
    await h.orch.hostDisconnected('offscreen');
    expect(h.orch.session).toMatchObject({ hostLost: true, state: 'paused' });
    await h.orch.command({ type: 'PLAY' });
    expect(h.ensures).toBe(2);
    h.connect('offscreen');
    await h.orch.hostEvent('offscreen', { type: 'HELLO', host: 'offscreen', status: null });
    expect(h.sent.offscreen.at(-1)).toMatchObject({
      type: 'LOAD',
      autoplay: true,
      start: { sentence: 3 },
    });
    expect(h.orch.session?.hostLost).toBe(false);
  });

  it('after a worker restart, resyncs with a host that kept playing instead of reloading', async () => {
    const stored: SessionInfo = {
      sessionId: 'old',
      docId: 'd1',
      title: 'Doc',
      host: 'offscreen',
      tabId: 7,
      state: 'playing',
      cursor: { sentence: 1, part: 0, word: 0 },
      settings: DEFAULT_SESSION_SETTINGS,
      sentenceCount: 4,
      hostLost: false,
      error: null,
      updatedAt: 0,
    };
    const h = setup({ stored });
    await h.orch.whenRestored();
    expect(h.orch.session?.sessionId).toBe('old');
    h.connect('offscreen');
    await h.orch.hostEvent('offscreen', {
      type: 'HELLO',
      host: 'offscreen',
      status: h.status('old', 'playing', 2),
    });
    expect(h.sent.offscreen).toHaveLength(0);
    expect(h.orch.session?.cursor.sentence).toBe(2);
  });

  it('reports a missing document instead of failing silently', async () => {
    const stored = {
      sessionId: 'x',
      docId: 'gone',
      title: '',
      host: 'offscreen',
      state: 'paused',
      cursor: { sentence: 0, part: 0, word: 0 },
      settings: DEFAULT_SESSION_SETTINGS,
      sentenceCount: 1,
      hostLost: true,
      error: null,
      updatedAt: 0,
    } satisfies SessionInfo;
    const h = setup({ stored });
    h.connect('offscreen');
    await h.orch.hostEvent('offscreen', { type: 'HELLO', host: 'offscreen', status: null });
    expect(h.orch.session?.error).toMatch(/no longer available/);
  });

  it('pauses the other host when one starts playing', async () => {
    const h = setup();
    h.connect('offscreen');
    h.connect('inpage');
    await h.orch.hostEvent('offscreen', { type: 'HELLO', host: 'offscreen', status: null });
    await h.orch.hostEvent('inpage', { type: 'HELLO', host: 'inpage', status: null });
    await h.orch.contentDoc(7, doc, 'https://x.test/a', undefined);
    const id = h.orch.session!.sessionId;
    await h.orch.hostEvent('offscreen', { type: 'STATUS', status: h.status(id, 'playing') });
    await h.orch.hostEvent('inpage', { type: 'STATUS', status: h.status('ip', 'playing') });
    expect(h.sent.offscreen.at(-1)).toEqual({
      type: 'PLAYER',
      sessionId: id,
      event: { type: 'PAUSE' },
    });
    await h.orch.hostEvent('offscreen', { type: 'STATUS', status: h.status(id, 'paused') });
    await h.orch.hostEvent('offscreen', { type: 'STATUS', status: h.status(id, 'playing') });
    expect(h.sent.inpage.at(-1)).toEqual({
      type: 'PLAYER',
      sessionId: 'ip',
      event: { type: 'PAUSE' },
    });
    await h.orch.hostEvent('inpage', {
      type: 'POSITION',
      position: { docId: 'pdf', sentenceId: 'a.0', word: 0, updatedAt: 1 },
    });
    expect(h.positions.at(-1)?.docId).toBe('pdf');
  });

  it('maps keyboard commands and starts reading the active tab when idle', async () => {
    const h = setup();
    await h.orch.keyboardCommand('toggle-play');
    expect(h.content.at(-1)).toEqual([7, 'extract']);
    await h.orch.keyboardCommand('unknown');
    await h.orch.command({ type: 'READ_TAB', tabId: 9 });
    expect(h.content.at(-1)).toEqual([9, 'extract']);
    await h.orch.command({ type: 'NEXT_SENTENCE' }); // no session: ignored
    expect(h.debug.filter((e) => e.kind === 'command').length).toBe(3);
  });

  it('unloads the previous session when a new page is read', async () => {
    const h = setup();
    h.connect('offscreen');
    await h.orch.hostEvent('offscreen', { type: 'HELLO', host: 'offscreen', status: null });
    await h.orch.contentDoc(7, doc, 'https://x.test/a', undefined);
    const first = h.orch.session!.sessionId;
    await h.orch.contentDoc(8, { ...doc, id: 'd2' }, 'https://x.test/b', {
      blockId: 'p',
      offset: 0,
    });
    expect(h.sent.offscreen.map((c) => c.type)).toEqual(['LOAD', 'UNLOAD', 'LOAD']);
    expect(h.sent.offscreen[1]).toEqual({ type: 'UNLOAD', sessionId: first });
    expect(h.orch.defaultSettings()).toEqual(DEFAULT_SESSION_SETTINGS);
  });
});

describe('Orchestrator diagnostics (§9.2)', () => {
  it('logs host, state, command and notice events and keeps the latest stats per host', async () => {
    const h = setup();
    h.connect('offscreen');
    await h.orch.contentDoc(7, doc, 'https://x.test/a', undefined);
    await h.orch.hostEvent('offscreen', { type: 'HELLO', host: 'offscreen', status: null });
    const sid = h.orch.session?.sessionId ?? '';
    await h.orch.hostEvent('offscreen', {
      type: 'STATUS',
      status: { ...h.status(sid, 'playing'), engine: 'kokoro', backend: 'webgpu' },
    });
    await h.orch.hostEvent('offscreen', {
      type: 'STATUS',
      status: { ...h.status(sid, 'error'), error: 'boom' },
    });
    await h.orch.hostEvent('offscreen', {
      type: 'NOTICE',
      sessionId: sid,
      notice: { kind: 'info', message: 'Switched to Piper because WebGPU failed.', detail: 'lost' },
    });
    const stats = {
      sessionId: sid,
      host: 'offscreen' as const,
      engine: 'piper',
      backend: 'wasm',
      state: 'playing' as const,
      rtf: 0.2,
      synthesized: 3,
      cacheHits: 1,
      bufferAhead: 21,
      stalls: 0,
      errors: 1,
      fallbacks: 1,
      engineRestarts: 0,
      at: 1000,
    };
    await h.orch.hostEvent('offscreen', { type: 'STATS', stats });
    await h.orch.command({ type: 'PAUSE' });
    const r = h.orch.diagnostics();
    expect(r.stats).toEqual([stats]);
    expect(r.session).not.toHaveProperty('title');
    expect(r.session).not.toHaveProperty('url');
    const lines = r.log.map((e) => `${e.level} ${e.source} ${e.message}`);
    expect(lines).toEqual(
      expect.arrayContaining([
        'info offscreen host connected',
        'info offscreen state playing (kokoro · webgpu)',
        'error offscreen state error',
        'info offscreen Switched to Piper because WebGPU failed.',
        'info ui command PAUSE',
      ]),
    );
    expect(r.log.find((e) => e.level === 'error')?.detail).toBe('boom');
    // Nothing from the document leaks into the log.
    expect(JSON.stringify(r)).not.toContain('https://x.test/a');
    await h.orch.hostDisconnected('offscreen');
    expect(h.orch.diagnostics().stats).toEqual([]);
    expect(h.orch.diagnostics().log.at(-1)).toMatchObject({
      level: 'warn',
      message: 'host disconnected',
    });
  });
});

describe('protocol', () => {
  it('accepts valid UI commands and rejects the rest', () => {
    expect(parseUiCommand({ type: 'PLAY' })).toEqual({ type: 'PLAY' });
    expect(parseUiCommand({ type: 'SEEK', sentence: 3, word: 1 })).toEqual({
      type: 'SEEK',
      sentence: 3,
      word: 1,
    });
    expect(parseUiCommand({ type: 'SET_SPEED', rate: 9 })).toBeUndefined();
    expect(parseUiCommand({ type: 'SEEK', sentence: -1 })).toBeUndefined();
    expect(parseUiCommand({ type: 'EVAL', code: 'x' })).toBeUndefined();
    expect(parseUiCommand('PLAY')).toBeUndefined();
  });
});
