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
