import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { postProcess } from '@/core/audio/process';
import type { BackendEvent } from '@/core/player/backend';
import { RenderedBackend, START_POLL_LIMIT_MS } from '@/engines/playback/rendered';
import { synthesizeTone } from '@/engines/test/engine';

class FakeAudio extends EventTarget {
  src = '';
  paused = true;
  ended = false;
  currentTime = 0;
  playbackRate = 1;
  defaultPlaybackRate = 1;
  preservesPitch = false;
  preload = '';
  error: { message: string; code: number } | null = null;
  loads = 0;
  load() {
    this.loads++;
  }
  play() {
    this.paused = false;
    this.dispatchEvent(new Event('playing'));
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}

const audio = (text: string) => {
  const r = synthesizeTone(text);
  return postProcess(r.pcm, r.sampleRate, r.words ?? [], { pauseAfter: 0.2 });
};

function make() {
  const els: FakeAudio[] = [];
  const b = new RenderedBackend(
    () => {
      const a = new FakeAudio();
      els.push(a);
      return a as unknown as HTMLAudioElement;
    },
    () => 1000,
  );
  const events: BackendEvent[] = [];
  b.subscribe((e) => events.push(e));
  return { b, els, events };
}

describe('RenderedBackend', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('announces the start once the media clock moves, with the real clock', () => {
    const { b, els, events } = make();
    b.play(audio('first'), { rate: 1 });
    vi.advanceTimersByTime(12);
    expect(events).toEqual([]);
    els[0]!.currentTime = 0.004;
    vi.advanceTimersByTime(4);
    expect(events).toEqual([{ type: 'started', mediaTime: 0.004, epochMs: 1000 }]);
    // Paused before the clock moved: nothing is announced.
    b.play(audio('second'), { rate: 1 });
    b.pause();
    vi.advanceTimersByTime(START_POLL_LIMIT_MS + 10);
    expect(events).toHaveLength(1);
  });

  it('sets preservesPitch on both decks and plays one at a time', () => {
    const { b, els, events } = make();
    expect(els.every((e) => e.preservesPitch)).toBe(true);
    const a1 = audio('first');
    const a2 = audio('second');
    b.play(a1, { rate: 1.5 });
    expect(b.audibleCount()).toBe(1);
    vi.advanceTimersByTime(START_POLL_LIMIT_MS + 10); // the fake clock never moves
    expect(events[0]).toEqual({ type: 'started', mediaTime: 0, epochMs: 1000 });
    b.preload(a2);
    b.preload(a2); // idempotent
    expect(els[1]!.loads).toBe(1);
    b.play(a2, { rate: 1.5 });
    expect(b.audibleCount()).toBe(1);
    // The preloaded deck was reused, not reloaded.
    expect(els[1]!.loads).toBe(1);
    expect(els[1]!.playbackRate).toBe(1.5);
    expect(els[0]!.paused).toBe(true);
  });

  it('pauses, resumes, changes rate, seeks to an offset and stops', () => {
    const { b, els } = make();
    b.play(audio('hello world'), { rate: 1, offset: 0.3 });
    expect(els[0]!.currentTime).toBe(0.3);
    b.pause();
    expect(b.audibleCount()).toBe(0);
    b.setRate(2.5);
    b.resume();
    expect(els[0]!.playbackRate).toBe(2.5);
    expect(b.mediaTime()).toBe(0.3);
    b.stop();
    expect(b.audibleCount()).toBe(0);
  });

  it('forwards ended and error only from the active deck', () => {
    const { b, els, events } = make();
    b.play(audio('x'), { rate: 1 });
    vi.advanceTimersByTime(START_POLL_LIMIT_MS + 10);
    els[1]!.dispatchEvent(new Event('ended'));
    expect(events.filter((e) => e.type === 'ended')).toHaveLength(0);
    els[0]!.dispatchEvent(new Event('ended'));
    els[0]!.error = { message: 'decode', code: 3 };
    els[0]!.dispatchEvent(new Event('error'));
    expect(events.map((e) => e.type)).toEqual(['started', 'ended', 'error']);
  });
});
