import { describe, expect, it } from 'vitest';
import { createActor } from 'xstate';
import {
  MAX_RETRIES,
  playerMachine,
  type Cursor,
  type PlayerEvent,
  type PlayerNav,
} from '@/core/player/machine';

const LAST = 9;
const nav: PlayerNav = {
  next: (c) => (c.sentence < LAST ? { sentence: c.sentence + 1, part: 0, word: 0 } : undefined),
  resolve: (e, c) => {
    switch (e.type) {
      case 'SEEK':
        return { sentence: e.sentence, part: 0, word: e.word ?? 0 };
      case 'NEXT_SENTENCE':
      case 'NEXT_BLOCK':
        return c.sentence < LAST ? { sentence: c.sentence + 1, part: 0, word: 0 } : undefined;
      case 'PREV_SENTENCE':
      case 'PREV_BLOCK':
        return c.sentence > 0 ? { sentence: c.sentence - 1, part: 0, word: 0 } : undefined;
    }
  },
};

function run(events: PlayerEvent[], start?: Cursor) {
  const calls: string[] = [];
  const named = [
    'requestSegment',
    'startAudio',
    'pauseAudio',
    'stopAudio',
    'applyRate',
    'persist',
    'replan',
    'announceError',
  ] as const;
  const actions = Object.fromEntries(named.map((n) => [n, () => void calls.push(n)]));
  const actor = createActor(playerMachine.provide({ actions }), { input: { nav, start } });
  actor.start();
  for (const e of events) actor.send(e);
  const s = actor.getSnapshot();
  actor.stop();
  return { state: s.value, ctx: s.context, calls };
}

const READY: PlayerEvent = { type: 'SEGMENT_READY' };
const FAIL: PlayerEvent = { type: 'SEGMENT_FAILED', message: 'engine crashed' };

describe('player machine transitions', () => {
  it.each<[string, PlayerEvent[], string]>([
    ['starts idle', [], 'idle'],
    ['PLAY → preparing', [{ type: 'PLAY' }], 'preparing'],
    ['ready → playing', [{ type: 'PLAY' }, READY], 'playing'],
    ['TOGGLE from idle plays', [{ type: 'TOGGLE' }, READY], 'playing'],
    ['pause while preparing', [{ type: 'PLAY' }, { type: 'PAUSE' }], 'paused'],
    ['pause → paused', [{ type: 'PLAY' }, READY, { type: 'PAUSE' }], 'paused'],
    [
      'toggle twice resumes',
      [{ type: 'PLAY' }, READY, { type: 'TOGGLE' }, { type: 'TOGGLE' }],
      'playing',
    ],
    [
      'audio end with next → buffering',
      [{ type: 'PLAY' }, READY, { type: 'AUDIO_ENDED' }],
      'buffering',
    ],
    [
      'buffering ready → playing',
      [{ type: 'PLAY' }, READY, { type: 'AUDIO_ENDED' }, READY],
      'playing',
    ],
    ['stall → buffering', [{ type: 'PLAY' }, READY, { type: 'AUDIO_STALLED' }], 'buffering'],
    ['seek while playing', [{ type: 'PLAY' }, READY, { type: 'SEEK', sentence: 5 }], 'seeking'],
    [
      'seek ready → playing',
      [{ type: 'PLAY' }, READY, { type: 'SEEK', sentence: 5 }, READY],
      'playing',
    ],
    [
      'seek while paused stays paused',
      [{ type: 'PLAY' }, READY, { type: 'PAUSE' }, { type: 'SEEK', sentence: 5 }, READY],
      'paused',
    ],
    [
      'play during a paused seek plays',
      [
        { type: 'PLAY' },
        READY,
        { type: 'PAUSE' },
        { type: 'SEEK', sentence: 5 },
        { type: 'PLAY' },
        READY,
      ],
      'playing',
    ],
    ['failure → retrying', [{ type: 'PLAY' }, FAIL], 'retrying'],
    ['stop → idle', [{ type: 'PLAY' }, READY, { type: 'STOP' }], 'idle'],
    ['host lost → paused', [{ type: 'PLAY' }, READY, { type: 'HOST_LOST' }], 'paused'],
    [
      'play after host lost reloads',
      [{ type: 'PLAY' }, READY, { type: 'HOST_LOST' }, { type: 'PLAY' }],
      'preparing',
    ],
    ['sleep timer pauses', [{ type: 'PLAY' }, READY, { type: 'SLEEP_TIMER_FIRED' }], 'paused'],
    ['doc change → idle', [{ type: 'PLAY' }, READY, { type: 'DOC_CHANGED' }], 'idle'],
    [
      'voice change while playing rebuffers',
      [{ type: 'PLAY' }, READY, { type: 'SET_VOICE', voice: 'bf_emma' }],
      'seeking',
    ],
    [
      'speed change keeps playing',
      [{ type: 'PLAY' }, READY, { type: 'SET_SPEED', rate: 2 }],
      'playing',
    ],
    [
      'next sentence at the end does nothing',
      [{ type: 'SEEK', sentence: LAST }, { type: 'PLAY' }, READY, { type: 'NEXT_SENTENCE' }],
      'playing',
    ],
  ])('%s', (_name, events, state) => {
    expect(run(events).state).toBe(state);
  });

  it('ends after the last segment and restarts from the top on PLAY', () => {
    const r = run([
      { type: 'SEEK', sentence: LAST },
      { type: 'PLAY' },
      READY,
      { type: 'AUDIO_ENDED' },
    ]);
    expect(r.state).toBe('ended');
    const again = run([
      { type: 'SEEK', sentence: LAST },
      { type: 'PLAY' },
      READY,
      { type: 'AUDIO_ENDED' },
      { type: 'PLAY' },
    ]);
    expect(again.state).toBe('preparing');
    expect(again.ctx.cursor.sentence).toBe(0);
  });

  it('advances the cursor and persists on every sentence boundary', () => {
    const r = run([
      { type: 'PLAY' },
      READY,
      { type: 'AUDIO_ENDED' },
      READY,
      { type: 'AUDIO_ENDED' },
    ]);
    expect(r.ctx.cursor.sentence).toBe(2);
    // persist runs on each playing entry and each boundary; the Player de-duplicates by sentence.
    expect(r.calls.filter((c) => c === 'persist').length).toBeGreaterThanOrEqual(3);
  });

  it('pausing and resuming resumes the loaded audio', () => {
    const r = run([{ type: 'PLAY' }, READY, { type: 'PAUSE' }, { type: 'PLAY' }]);
    expect(r.state).toBe('playing');
    expect(r.ctx.loaded).toBe(true);
    expect(r.calls.filter((c) => c === 'requestSegment')).toHaveLength(1);
  });

  it('navigates while idle without playing', () => {
    const r = run([
      { type: 'NEXT_SENTENCE' },
      { type: 'NEXT_BLOCK' },
      { type: 'PREV_SENTENCE' },
      { type: 'PREV_BLOCK' },
      { type: 'SEEK', sentence: 7, word: 3 },
    ]);
    expect(r.state).toBe('idle');
    expect(r.ctx.cursor).toEqual({ sentence: 7, part: 0, word: 3 });
  });

  it('clamps speed to 0.5–4× and applies it', () => {
    const r = run([{ type: 'SET_SPEED', rate: 9 }]);
    expect(r.ctx.rate).toBe(4);
    expect(run([{ type: 'SET_SPEED', rate: 0.1 }]).ctx.rate).toBe(0.5);
    expect(r.calls).toContain('applyRate');
  });

  it('records voice and pacing and replans', () => {
    const r = run([
      { type: 'SET_VOICE', voice: 'am_michael' },
      { type: 'SET_PACING', pacing: 'brisk' },
    ]);
    expect(r.ctx.voice).toBe('am_michael');
    expect(r.ctx.pacing).toBe('brisk');
    expect(r.calls.filter((c) => c === 'replan')).toHaveLength(2);
  });

  it(`gives up after ${MAX_RETRIES} retries with a user-visible retry action`, () => {
    const r = run([{ type: 'PLAY' }, FAIL]);
    expect(r.ctx.retries).toBe(1);
    const e = run([{ type: 'PLAY' }, FAIL, FAIL, FAIL]);
    // Without timers, retrying waits; failures from 'seeking' after backoff are covered in player tests.
    expect(['retrying', 'error']).toContain(e.state);
  });

  it('error is never terminal: RETRY, PLAY, SEEK and voice change all leave it', async () => {
    const calls: string[] = [];
    const actor = createActor(
      playerMachine.provide({
        actions: { announceError: () => void calls.push('announce') },
        delays: { backoff: 0 },
      }),
      { input: { nav } },
    );
    actor.start();
    actor.send({ type: 'PLAY' });
    for (let i = 0; i <= MAX_RETRIES; i++) {
      actor.send(FAIL);
      await new Promise((r) => setTimeout(r, 1));
    }
    expect(actor.getSnapshot().value).toBe('error');
    expect(actor.getSnapshot().context.error).toEqual({
      message: 'engine crashed',
      action: 'retry',
    });
    expect(calls).toEqual(['announce']);
    for (const exit of [
      { type: 'RETRY' },
      { type: 'PLAY' },
      { type: 'TOGGLE' },
      { type: 'SEEK', sentence: 2 },
      { type: 'NEXT_SENTENCE' },
      { type: 'SET_VOICE', voice: 'x' },
    ] as PlayerEvent[]) {
      const a = createActor(playerMachine.provide({ delays: { backoff: 0 } }), { input: { nav } });
      a.start();
      a.send({ type: 'PLAY' });
      for (let i = 0; i <= MAX_RETRIES; i++) {
        a.send(FAIL);
        await new Promise((r) => setTimeout(r, 1));
      }
      expect(a.getSnapshot().value).toBe('error');
      a.send(exit);
      expect(a.getSnapshot().value).toBe('seeking');
      expect(a.getSnapshot().context.error).toBeNull();
      a.stop();
    }
    actor.stop();
  });

  it('retrying can be paused or redirected', () => {
    expect(run([{ type: 'PLAY' }, FAIL, { type: 'PAUSE' }]).state).toBe('paused');
    expect(run([{ type: 'PLAY' }, FAIL, { type: 'SEEK', sentence: 3 }]).state).toBe('seeking');
  });

  it('paused voice change stays paused; preparing/buffering navigation goes to seeking', () => {
    expect(
      run([{ type: 'PLAY' }, READY, { type: 'PAUSE' }, { type: 'SET_VOICE', voice: 'x' }]).state,
    ).toBe('paused');
    expect(run([{ type: 'PLAY' }, { type: 'NEXT_SENTENCE' }]).state).toBe('seeking');
    expect(
      run([{ type: 'PLAY' }, READY, { type: 'AUDIO_ENDED' }, { type: 'PREV_BLOCK' }]).state,
    ).toBe('seeking');
    expect(
      run([{ type: 'PLAY' }, READY, { type: 'AUDIO_ENDED' }, { type: 'SET_VOICE', voice: 'x' }])
        .state,
    ).toBe('seeking');
    expect(run([{ type: 'PLAY' }, { type: 'SET_VOICE', voice: 'x' }]).state).toBe('seeking');
    expect(
      run([{ type: 'PLAY' }, READY, { type: 'SEEK', sentence: 1 }, { type: 'TOGGLE' }, READY])
        .state,
    ).toBe('paused');
  });
});
