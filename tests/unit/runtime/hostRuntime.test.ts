import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlock } from '@/core/document/build';
import { HostRuntime } from '@/runtime/hostRuntime';
import { DEFAULT_SESSION_SETTINGS, type HostEvent } from '@/runtime/protocol';
import { TestEngine } from '@/engines/test/engine';
import { FakeBackend } from '../helpers/fakeBackend';

const doc = {
  id: 'd',
  kind: 'web' as const,
  title: 'T',
  lang: 'en',
  blocks: [buildBlock({ id: 'p', type: 'paragraph', text: 'One here. Two here. Three here.' })],
};

describe('HostRuntime', () => {
  beforeEach(() =>
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    }),
  );
  afterEach(() => vi.useRealTimers());

  it('loads, plays, reports status and positions, and unloads', async () => {
    const events: HostEvent[] = [];
    let resets = 0;
    const rt = new HostRuntime({
      kind: 'offscreen',
      backend: new FakeBackend(),
      engineFor: async () => ({ engine: new TestEngine(), model: { modelId: 't', version: '1' } }),
      emit: (e) => events.push(e),
      resetEngine: () => void resets++,
    });
    rt.hello();
    expect(events[0]).toEqual({ type: 'HELLO', host: 'offscreen', status: null });
    await rt.handle({
      type: 'LOAD',
      sessionId: 's',
      doc,
      start: { sentence: 1, word: 0 },
      settings: DEFAULT_SESSION_SETTINGS,
      autoplay: true,
    });
    await vi.advanceTimersByTimeAsync(500);
    expect(rt.status()).toMatchObject({
      sessionId: 's',
      state: 'playing',
      cursor: { sentence: 1 },
    });
    expect(events.some((e) => e.type === 'STATUS' && e.status.state === 'playing')).toBe(true);
    expect(events.some((e) => e.type === 'SYNC')).toBe(true);
    expect(events.some((e) => e.type === 'POSITION')).toBe(true);
    await rt.handle({ type: 'PLAYER', sessionId: 'other', event: { type: 'PAUSE' } });
    expect(rt.status()?.state).toBe('playing');
    await rt.handle({ type: 'PLAYER', sessionId: 's', event: { type: 'PAUSE' } });
    expect(rt.status()?.state).toBe('paused');
    await rt.restartEngine();
    expect(resets).toBe(1);
    expect(rt.currentDoc?.id).toBe('d');
    await rt.handle({ type: 'UNLOAD', sessionId: 's' });
    expect(rt.status()).toBeNull();
    await rt.restartEngine(); // no session: no-op
    expect(resets).toBe(1);
  });
});

describe('HostRuntime load races', () => {
  it('a newer LOAD supersedes one still waiting for its engine', async () => {
    const events: HostEvent[] = [];
    const rt = new HostRuntime({
      kind: 'offscreen',
      backend: new FakeBackend(),
      engineFor: () =>
        new Promise((r) =>
          setTimeout(
            () => r({ engine: new TestEngine(), model: { modelId: 't', version: '1' } }),
            5,
          ),
        ),
      emit: (e) => events.push(e),
    });
    const a = rt.handle({
      type: 'LOAD',
      sessionId: 's',
      doc,
      start: { sentence: 0, word: 0 },
      settings: DEFAULT_SESSION_SETTINGS,
      autoplay: false,
    });
    const b = rt.handle({
      type: 'LOAD',
      sessionId: 's',
      doc,
      start: { sentence: 2, word: 0 },
      settings: DEFAULT_SESSION_SETTINGS,
      autoplay: false,
    });
    await Promise.all([a, b]);
    expect(rt.status()?.cursor.sentence).toBe(2);
    expect(events.filter((e) => e.type === 'STATUS')).toHaveLength(1);
  });
});

describe('HostRuntime engine failures', () => {
  it('reports a visible error when the engine cannot start', async () => {
    const events: HostEvent[] = [];
    const rt = new HostRuntime({
      kind: 'offscreen',
      backend: new FakeBackend(),
      engineFor: async () => {
        throw new Error('Missing file models/kokoro/onnx/model.onnx');
      },
      emit: (e) => events.push(e),
    });
    await rt.handle({
      type: 'LOAD',
      sessionId: 's',
      doc,
      start: { sentence: 0, word: 0 },
      settings: DEFAULT_SESSION_SETTINGS,
      autoplay: true,
    });
    expect(events.map((e) => e.type)).toEqual(['NOTICE', 'STATUS']);
    const st = events[1];
    expect(st?.type === 'STATUS' && st.status.state).toBe('error');
    expect(st?.type === 'STATUS' && st.status.error).toMatch(/Voices & models/);
  });
});

describe('HostRuntime fallback ladder (§9.2)', () => {
  beforeEach(() =>
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    }),
  );
  afterEach(() => vi.useRealTimers());

  const settings = {
    ...DEFAULT_SESSION_SETTINGS,
    engineId: 'kokoro',
    modelId: 'kokoro-82m',
    voice: 'af_heart',
    cacheCapBytes: 1024,
    fallbacks: [
      { engineId: 'kokoro', modelId: 'kokoro-82m', backend: 'wasm' as const },
      { engineId: 'piper', modelId: 'piper-x', voice: 'x' },
    ],
  };
  const notices = (events: HostEvent[]) =>
    events.flatMap((e) => (e.type === 'NOTICE' ? [e.notice] : []));

  it('retries the same engine once, then walks the rungs and announces the switch', async () => {
    const events: HostEvent[] = [];
    const tried: string[] = [];
    let resets = 0;
    const setCap = vi.fn(async () => undefined);
    const rt = new HostRuntime({
      kind: 'offscreen',
      backend: new FakeBackend(),
      cache: {
        get: async () => undefined,
        put: async () => undefined,
        size: async () => 0,
        clear: async () => undefined,
        setCap,
        stats: { hits: 0, misses: 0 },
      },
      engineFor: async (s) => {
        tried.push(`${s.engineId}:${s.backend ?? 'auto'}:${s.voice}`);
        if (s.engineId === 'kokoro') throw new Error(`${s.backend ?? 'webgpu'} adapter lost`);
        return { engine: new TestEngine(), model: { modelId: 'p', version: '1' } };
      },
      emit: (e) => events.push(e),
      resetEngine: () => void resets++,
    });
    await rt.handle({
      type: 'LOAD',
      sessionId: 's',
      doc,
      start: { sentence: 0, word: 0 },
      settings,
      autoplay: true,
    });
    expect(setCap).toHaveBeenCalledWith(1024);
    expect(tried).toEqual([
      'kokoro:auto:af_heart',
      'kokoro:auto:af_heart',
      'kokoro:wasm:af_heart',
      'piper:auto:x',
    ]);
    expect(resets).toBe(1);
    expect(notices(events)).toEqual([
      {
        kind: 'info',
        message: 'Switched to Piper because Kokoro failed.',
        detail: 'wasm adapter lost',
      },
    ]);
    await vi.advanceTimersByTimeAsync(1100);
    const stats = events.findLast((e) => e.type === 'STATS');
    expect(stats?.type === 'STATS' && stats.stats).toMatchObject({
      sessionId: 's',
      host: 'offscreen',
      fallbacks: 1,
      engine: 'test',
    });
    rt.dispose();
  });

  it('reports an error when every rung fails', async () => {
    const events: HostEvent[] = [];
    const rt = new HostRuntime({
      kind: 'offscreen',
      backend: new FakeBackend(),
      engineFor: async () => {
        throw new Error('no voice');
      },
      emit: (e) => events.push(e),
    });
    await rt.handle({
      type: 'LOAD',
      sessionId: 's',
      doc,
      start: { sentence: 0, word: 0 },
      settings,
      autoplay: true,
    });
    expect(notices(events)[0]?.message).toMatch(/The voice could not start: no voice/);
    expect(events.findLast((e) => e.type === 'STATUS')).toMatchObject({
      status: { state: 'error' },
    });
  });

  it('moves down the ladder when synthesis keeps failing during playback', async () => {
    const events: HostEvent[] = [];
    const engines: string[] = [];
    const rt = new HostRuntime({
      kind: 'offscreen',
      backend: new FakeBackend(),
      engineFor: async (s) => {
        engines.push(s.engineId);
        const engine =
          s.engineId === 'kokoro'
            ? new TestEngine({ failAlways: true, failCalls: [0, 1, 2, 3, 4, 5] })
            : new TestEngine();
        return { engine, model: { modelId: s.engineId, version: '1' } };
      },
      emit: (e) => events.push(e),
      resetEngine: () => undefined,
    });
    await rt.handle({
      type: 'LOAD',
      sessionId: 's',
      doc,
      start: { sentence: 1, word: 0 },
      settings: { ...settings, fallbacks: [{ engineId: 'piper', modelId: 'piper-x', voice: 'x' }] },
      autoplay: true,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(engines).toEqual(['kokoro', 'piper']);
    expect(notices(events).find((n) => n.message.startsWith('Switched'))).toMatchObject({
      message: 'Switched to Piper because Kokoro failed.',
    });
    // Piper picks up at the sentence that failed and reads on to the end.
    const started = events.flatMap((e) =>
      e.type === 'SYNC' && e.event.type === 'SEGMENT_STARTED' ? [e.event.sentenceIndex] : [],
    );
    expect(started[0]).toBe(1);
    expect(rt.status()?.state).toBe('ended');
    rt.dispose();
  });
});

describe('HostRuntime idle engine release (ADR 0017)', () => {
  beforeEach(() =>
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    }),
  );
  afterEach(() => vi.useRealTimers());

  it('releases the engine after an idle stretch and reloads it at the same sentence on Play', async () => {
    const opened: number[] = [];
    let resets = 0;
    const rt = new HostRuntime({
      kind: 'inpage',
      backend: new FakeBackend(),
      engineFor: async () => {
        opened.push(Date.now());
        return { engine: new TestEngine(), model: { modelId: 't', version: '1' } };
      },
      emit: () => undefined,
      resetEngine: () => void resets++,
      idleReleaseMs: 60_000,
    });
    await rt.handle({
      type: 'LOAD',
      sessionId: 's',
      doc,
      start: { sentence: 0, word: 0 },
      settings: DEFAULT_SESSION_SETTINGS,
      autoplay: true,
    });
    await vi.advanceTimersByTimeAsync(1500);
    await rt.handle({ type: 'PLAYER', sessionId: 's', event: { type: 'PAUSE' } });
    const at = rt.status()?.cursor.sentence;
    await vi.advanceTimersByTimeAsync(59_000);
    expect(rt.engineReleased).toBe(false);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(rt.engineReleased).toBe(true);
    expect(resets).toBe(1);
    await rt.handle({ type: 'PLAYER', sessionId: 's', event: { type: 'PLAY' } });
    expect(opened).toHaveLength(2);
    expect(rt.engineReleased).toBe(false);
    await vi.advanceTimersByTimeAsync(300);
    expect(rt.status()).toMatchObject({ state: 'playing', cursor: { sentence: at } });
    // Playing keeps the engine.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(resets).toBe(1);
    rt.dispose();
  });
});

describe('HostRuntime export and pronunciations (M11)', () => {
  const memoryExporter = () => {
    const files = new Map<string, Uint8Array>();
    const released: string[] = [];
    return {
      files,
      released,
      exporter: {
        store: {
          appender: async (p: string) => ({
            write: async (c: Uint8Array) => {
              const o = files.get(p) ?? new Uint8Array(0);
              const n = new Uint8Array(o.length + c.length);
              n.set(o);
              n.set(c, o.length);
              files.set(p, n);
            },
            close: async () => undefined,
          }),
          slice: async (p: string, a: number, b: number) =>
            (files.get(p) ?? new Uint8Array(0)).slice(a, b).buffer,
          remove: async (p: string) => void files.delete(p),
        },
        mp3: async () => ({
          encode: (pcm: Float32Array) => new Uint8Array(pcm.length >> 4),
          finalize: () => new Uint8Array(4),
        }),
        url: async (p: string) => `blob:${p}`,
        release: async (_u: string, p: string) => void released.push(p),
      },
    };
  };

  it('exports the loaded document, reports progress, and releases the file on request', async () => {
    const events: HostEvent[] = [];
    const m = memoryExporter();
    const rt = new HostRuntime({
      kind: 'offscreen',
      backend: new FakeBackend(),
      engineFor: async () => ({ engine: new TestEngine(), model: { modelId: 't', version: '1' } }),
      emit: (e) => events.push(e),
      exporter: m.exporter,
    });
    await rt.handle({
      type: 'LOAD',
      sessionId: 's',
      doc,
      start: { sentence: 0, word: 0 },
      settings: DEFAULT_SESSION_SETTINGS,
      autoplay: false,
    });
    await rt.handle({
      type: 'EXPORT',
      sessionId: 's',
      jobId: 'j',
      format: 'mp3',
      artist: 'Open Reader',
    });
    await vi.waitFor(() =>
      expect(events.some((e) => e.type === 'EXPORT' && e.status.state === 'done')).toBe(true),
    );
    const exportEvents = events.flatMap((e) => (e.type === 'EXPORT' ? [e] : []));
    expect(exportEvents.some((e) => e.status.state === 'running' && e.status.fraction > 0)).toBe(
      true,
    );
    const done = exportEvents.at(-1);
    expect(done).toMatchObject({
      url: 'blob:exports/j.mp3',
      status: { filename: 'T.mp3', fraction: 1 },
    });
    await rt.handle({ type: 'EXPORT_RELEASE', jobId: 'j' });
    expect(m.released).toEqual(['exports/j.mp3']);
    rt.dispose();
  });

  it('refuses to export without a document or with system voices, and cancels', async () => {
    const events: HostEvent[] = [];
    const m = memoryExporter();
    const rt = new HostRuntime({
      kind: 'offscreen',
      backend: new FakeBackend(),
      engineFor: async () => ({
        engine: new TestEngine({ delayMs: 20 }),
        model: { modelId: 't', version: '1' },
      }),
      emit: (e) => events.push(e),
      exporter: m.exporter,
    });
    await rt.handle({ type: 'EXPORT', sessionId: 's', jobId: 'a', format: 'wav' });
    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({ type: 'EXPORT', status: { state: 'error' } }),
    );
    await rt.handle({
      type: 'LOAD',
      sessionId: 's',
      doc,
      start: { sentence: 0, word: 0 },
      settings: DEFAULT_SESSION_SETTINGS,
      autoplay: false,
    });
    await rt.handle({ type: 'EXPORT', sessionId: 's', jobId: 'b', format: 'wav' });
    await rt.handle({ type: 'EXPORT_CANCEL', jobId: 'b' });
    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({
        type: 'EXPORT',
        status: { jobId: 'b', state: 'cancelled' },
      }),
    );
    expect(m.files.size).toBe(0);

    const live = new HostRuntime({
      kind: 'offscreen',
      backend: new FakeBackend(),
      engineFor: async () => ({
        engine: {
          ...new TestEngine(),
          id: 'system',
          caps: { ...new TestEngine().caps, live: true },
        } as unknown as TestEngine,
        model: { modelId: 'system', version: '1' },
      }),
      emit: (e) => events.push(e),
      exporter: m.exporter,
    });
    await live.handle({
      type: 'LOAD',
      sessionId: 'l',
      doc,
      start: { sentence: 0, word: 0 },
      settings: DEFAULT_SESSION_SETTINGS,
      autoplay: false,
    });
    await live.handle({ type: 'EXPORT', sessionId: 'l', jobId: 'c', format: 'mp3' });
    await vi.waitFor(() =>
      expect(events.at(-1)).toMatchObject({
        status: { jobId: 'c', state: 'error', message: expect.stringMatching(/System voices/) },
      }),
    );
    rt.dispose();
    live.dispose();
  });

  it('applies new pronunciations to upcoming segments', async () => {
    const engine = new TestEngine();
    const rt = new HostRuntime({
      kind: 'offscreen',
      backend: new FakeBackend(),
      engineFor: async () => ({ engine, model: { modelId: 't', version: '1' } }),
      emit: () => undefined,
    });
    await rt.handle({
      type: 'LOAD',
      sessionId: 's',
      doc,
      start: { sentence: 0, word: 0 },
      settings: DEFAULT_SESSION_SETTINGS,
      autoplay: false,
    });
    await rt.handle({
      type: 'SET_LEXICON',
      sessionId: 's',
      lexicon: { user: [{ id: '1', match: 'Two', say: 'deux' }], packs: [] },
    });
    expect(rt.player?.segmentsFor(1)[0]?.spoken).toBe('deux here.');
    rt.dispose();
  });
});
