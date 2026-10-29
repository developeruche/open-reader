import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlock } from '@/core/document/build';
import type { ReadingDocument, ReadingPosition } from '@/core/document/model';
import { MemoryCache } from '@/core/player/cache';
import { modelSpeedFor, Player, type PlayerNotice } from '@/core/player/player';
import type { SyncEvent } from '@/core/player/sync';
import { TestEngine, type TestEngineFaults } from '@/engines/test/engine';
import { FakeBackend } from '../../helpers/fakeBackend';

function makeDoc(): ReadingDocument {
  return {
    id: 'doc',
    kind: 'web',
    title: 'PSBTs',
    lang: 'en',
    blocks: [
      buildBlock({ id: 'h', type: 'heading', level: 1, text: 'The four roles' }),
      buildBlock({
        id: 'p1',
        type: 'paragraph',
        text: 'A PSBT is a container. Each wallet adds data. Nobody shares keys [12].',
      }),
      buildBlock({ id: 'c', type: 'code', text: 'bitcoin-cli walletprocesspsbt' }),
      buildBlock({ id: 'l1', type: 'listItem', text: 'The creator proposes inputs.' }),
      buildBlock({ id: 'l2', type: 'listItem', text: 'The signer signs.' }),
      buildBlock({ id: 'p2', type: 'paragraph', text: 'That is all.' }),
    ].map((b) => (b.type === 'code' ? { ...b, skip: 'code' as const } : b)),
  };
}

interface Harness {
  player: Player;
  backend: FakeBackend;
  engine: TestEngine;
  sync: SyncEvent[];
  persisted: ReadingPosition[];
  notices: PlayerNotice[];
  states: string[];
  cursors: number[];
  restarts: number;
}

function setup(
  faults: TestEngineFaults = {},
  opts: { cache?: MemoryCache; rate?: number; start?: number } = {},
): Harness {
  const backend = new FakeBackend();
  const engine = new TestEngine(faults);
  const h: Harness = {
    player: undefined as unknown as Player,
    backend,
    engine,
    sync: [],
    persisted: [],
    notices: [],
    states: [],
    cursors: [],
    restarts: 0,
  };
  h.player = new Player({
    doc: makeDoc(),
    engine,
    model: { modelId: 'test', version: '1' },
    backend,
    sessionId: 's1',
    cache: opts.cache,
    settings: { rate: opts.rate ?? 1, voice: 'test' },
    start: opts.start === undefined ? undefined : { sentence: opts.start },
    onSync: (e) => h.sync.push(e),
    onPersist: (p) => h.persisted.push(p),
    onNotice: (n) => h.notices.push(n),
    onEngineRestart: () => void h.restarts++,
  });
  h.player.actor.subscribe((s) => {
    h.states.push(String(s.value));
    if (s.value === 'playing') {
      h.cursors.push(s.context.cursor.sentence);
      // Invariant: every playing state has a live audio clock.
      expect(backend.audio).toBeDefined();
    }
  });
  return h;
}

const advance = async (ms: number) => {
  await vi.advanceTimersByTimeAsync(ms);
};

describe('Player (TestEngine + fake backend)', () => {
  beforeEach(() =>
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    }),
  );
  afterEach(() => vi.useRealTimers());

  it('reads the whole document in order and ends', async () => {
    const h = setup();
    h.player.send({ type: 'PLAY' });
    await advance(60_000);
    expect(h.player.state).toBe('ended');
    // Sentences: heading, 3 in p1, code announcement, two list items, last paragraph = 8.
    expect([...new Set(h.cursors)]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    const spoken = h.engine.requests.map((r) => r.text);
    expect(spoken).toContain('A P S B T is a container.');
    expect(spoken).toContain('Nobody shares keys.');
    expect(spoken).toContain('Code block skipped.');
  });

  it('never has two segments audible and position is monotonic while playing', async () => {
    const h = setup();
    h.player.send({ type: 'PLAY' });
    await advance(60_000);
    expect(h.backend.maxAudible).toBe(1);
    for (let i = 1; i < h.cursors.length; i++)
      expect(h.cursors[i]!).toBeGreaterThanOrEqual(h.cursors[i - 1]!);
  });

  it('persists the position on every sentence boundary', async () => {
    const h = setup();
    h.player.send({ type: 'PLAY' });
    await advance(60_000);
    const ids = h.persisted.map((p) => p.sentenceId);
    expect(ids).toEqual(['h.0', 'p1.0', 'p1.1', 'p1.2', 'c.0', 'l1.0', 'l2.0', 'p2.0']);
    expect(h.persisted.every((p) => p.docId === 'doc')).toBe(true);
  });

  it('emits SEGMENT_STARTED with display ranges, then SEGMENT_ENDED', async () => {
    const h = setup();
    h.player.send({ type: 'PLAY' });
    await advance(3000);
    const started = h.sync.filter((e) => e.type === 'SEGMENT_STARTED');
    expect(started.length).toBeGreaterThan(1);
    const s = started[1]!;
    if (s.type !== 'SEGMENT_STARTED') throw new Error();
    expect(s.sentenceId).toBe('p1.0');
    const text = makeDoc().blocks[1]!.text;
    expect(s.words.map((w) => text.slice(w.displayStart, w.displayEnd))).toEqual([
      'A',
      'PSBT',
      'PSBT',
      'PSBT',
      'PSBT',
      'is',
      'a',
      'container',
    ]);
    expect(s.rate).toBe(1);
    expect(h.sync.some((e) => e.type === 'SEGMENT_ENDED')).toBe(true);
  });

  it('keeps at least 4 segments or 20 s prefetched', async () => {
    const h = setup();
    h.player.send({ type: 'PLAY' });
    await advance(50);
    expect(h.player.scheduler.snapshot().ready).toBeGreaterThanOrEqual(4);
  });

  it('pauses and resumes the same audio without re-synthesizing', async () => {
    const h = setup();
    h.player.send({ type: 'PLAY' });
    await advance(300);
    const calls = h.engine.calls;
    h.player.send({ type: 'PAUSE' });
    const t = h.backend.mediaTime();
    await advance(35_000);
    expect(h.backend.mediaTime()).toBe(t);
    h.player.send({ type: 'PLAY' });
    await advance(10);
    expect(h.player.state).toBe('playing');
    expect(h.backend.plays).toHaveLength(1);
    expect(h.engine.calls).toBe(calls);
    expect(h.sync.map((e) => e.type)).toContain('PAUSED');
  });

  it('seeks, skips sentences and blocks, and clicks into a word', async () => {
    const h = setup();
    h.player.send({ type: 'PLAY' });
    await advance(100);
    h.player.send({ type: 'SEEK', sentence: 5 });
    await advance(50);
    expect(h.player.cursor.sentence).toBe(5);
    expect(h.player.state).toBe('playing');
    h.player.send({ type: 'NEXT_BLOCK' });
    await advance(50);
    expect(h.player.cursor.sentence).toBe(6);
    h.player.send({ type: 'PREV_SENTENCE' });
    await advance(50);
    expect(h.player.cursor.sentence).toBe(5);
    h.player.send({ type: 'PREV_BLOCK' });
    await advance(50);
    expect(h.player.cursor.sentence).toBe(4);
    h.player.send({ type: 'NEXT_SENTENCE' });
    await advance(50);
    expect(h.player.cursor.sentence).toBe(5);
    // Click-to-read the word "creator" (index 1) in l1.
    h.player.send({ type: 'SEEK', sentence: 5, word: 1 });
    await advance(50);
    const last = h.backend.plays.at(-1)!;
    expect(last.offset).toBeGreaterThan(0.1);
  });

  it('changes speed while playing and crosses into faster model speed above 2×', async () => {
    const h = setup();
    h.player.send({ type: 'PLAY' });
    await advance(200);
    h.player.send({ type: 'SET_SPEED', rate: 1.5 });
    expect(h.backend.rate).toBe(1.5);
    expect(h.sync.find((e) => e.type === 'RATE_CHANGED')).toMatchObject({ rate: 1.5 });
    h.player.send({ type: 'SET_SPEED', rate: 3 });
    await advance(20_000);
    expect(modelSpeedFor(3)).toBe(1.25);
    expect(h.engine.requests.some((r) => r.speed === 1.25)).toBe(true);
    expect(h.backend.plays.at(-1)!.rate).toBeCloseTo(3 / 1.25);
  });

  it('changes voice by re-buffering from the current sentence', async () => {
    const h = setup();
    h.player.send({ type: 'PLAY' });
    await advance(1500);
    const at = h.player.cursor.sentence;
    h.player.send({ type: 'SET_VOICE', voice: 'other' });
    await advance(50);
    expect(h.player.state).toBe('playing');
    expect(h.player.cursor.sentence).toBe(at);
    expect(h.engine.requests.at(-1)?.voiceId).toBe('other');
  });

  it('retries a failed segment, then plays it', async () => {
    const h = setup({ failCalls: [0] });
    h.player.send({ type: 'PLAY' });
    await advance(2000);
    expect(h.states).toContain('retrying');
    expect(h.player.state).toBe('playing');
  });

  it('shows an error with a retry action after repeated failures, and recovers', async () => {
    const h = setup({ failText: 'roles' });
    h.player.send({ type: 'PLAY' });
    await advance(5000);
    expect(h.player.state).toBe('error');
    expect(h.player.snapshot.context.error?.action).toBe('retry');
    expect(h.notices.at(-1)?.kind).toBe('error');
    h.player.send({ type: 'NEXT_SENTENCE' });
    await advance(100);
    expect(h.player.state).toBe('playing');
  });

  it('detects a stall, re-buffers, and restarts the engine after three', async () => {
    const h = setup();
    h.player.send({ type: 'PLAY' });
    await advance(100);
    for (let i = 0; i < 3; i++) {
      h.backend.freeze();
      await advance(2600);
      expect(h.states).toContain('buffering');
    }
    expect(h.restarts).toBe(1);
    expect(h.notices.some((n) => n.message.includes('restarted'))).toBe(true);
  });

  it('sends drift corrections every 2 s while playing', async () => {
    const h = setup();
    h.player.send({ type: 'PLAY' });
    await advance(5000);
    expect(h.sync.filter((e) => e.type === 'DRIFT').length).toBeGreaterThanOrEqual(2);
  });

  it('serves re-reads from the synthesis cache', async () => {
    const cache = new MemoryCache();
    const a = setup({}, { cache });
    a.player.send({ type: 'PLAY' });
    await advance(60_000);
    const first = a.engine.calls;
    a.player.dispose();
    const b = setup({}, { cache });
    b.player.send({ type: 'PLAY' });
    await advance(60_000);
    expect(b.engine.calls).toBe(0);
    expect(first).toBeGreaterThan(0);
    expect(cache.stats.hits).toBeGreaterThanOrEqual(first);
  });

  it('starts from a saved position and recovers after the host is lost', async () => {
    const h = setup({}, { start: 5 });
    h.player.send({ type: 'PLAY' });
    await advance(100);
    expect(h.player.cursor.sentence).toBe(5);
    h.player.send({ type: 'HOST_LOST' });
    expect(h.player.state).toBe('paused');
    expect(h.backend.audio).toBeUndefined();
    h.player.send({ type: 'PLAY' });
    await advance(50);
    expect(h.player.state).toBe('playing');
    expect(h.player.cursor.sentence).toBe(5);
  });

  it('stops and goes idle on STOP and DOC_CHANGED', async () => {
    const h = setup();
    h.player.send({ type: 'PLAY' });
    await advance(100);
    h.player.send({ type: 'STOP' });
    expect(h.player.state).toBe('idle');
    h.player.send({ type: 'PLAY' });
    await advance(100);
    h.player.send({ type: 'DOC_CHANGED' });
    expect(h.player.state).toBe('idle');
    expect(h.player.cursor.sentence).toBe(0);
  });

  it('splits a long first sentence for a fast start', async () => {
    const backend = new FakeBackend();
    const engine = new TestEngine();
    const long =
      'When the model runs on the GPU, the first audio arrives quickly, and the reader can start listening long before the whole sentence has been synthesized.';
    const player = new Player({
      doc: {
        id: 'd',
        kind: 'web',
        title: '',
        lang: 'en',
        blocks: [buildBlock({ id: 'p', type: 'paragraph', text: long })],
      },
      engine,
      model: { modelId: 't', version: '1' },
      backend,
      sessionId: 's',
    });
    player.send({ type: 'PLAY' });
    await advance(20);
    expect(engine.requests[0]!.text).toBe('When the model runs on the G P U,');
    player.dispose();
  });

  it('pacing changes rebuild segments; skip rules can be changed live', async () => {
    const h = setup();
    h.player.send({ type: 'SET_PACING', pacing: 'relaxed' });
    expect(h.player.segmentsFor(1)[0]!.pauseAfter).toBeCloseTo(0.22 * 1.4);
    h.player.setSkipRules({ ...h.player['settings'].skipRules, announceSkippedCode: false });
    expect(h.player.segmentsFor(4)[0]!.spoken).not.toBe('Code block skipped.');
  });
});
