import { describe, expect, it } from 'vitest';
import { anchorFor, ClockFollower, type SyncEvent } from '@/core/player/sync';

const S = 's1';
const started = (
  mediaStartEpochMs: number,
  rate = 1,
): Extract<SyncEvent, { type: 'SEGMENT_STARTED' }> => ({
  type: 'SEGMENT_STARTED',
  sessionId: S,
  segmentId: 'p.0#0',
  sentenceId: 'p.0',
  blockId: 'p',
  sentenceIndex: 0,
  words: [0, 0.5, 1, 1.5, 2].map((t, i) => ({
    start: t,
    end: t + 0.4,
    displayStart: i * 4,
    displayEnd: i * 4 + 3,
    sentenceWord: i,
  })),
  mediaStartEpochMs,
  rate,
});

describe('ClockFollower', () => {
  it('computes media time and the current word', () => {
    const c = new ClockFollower();
    c.apply(started(1000));
    expect(c.mediaTime(1000)).toBe(0);
    expect(c.mediaTime(2200)).toBeCloseTo(1.2);
    expect(c.wordIndex(900)).toBe(0);
    expect(c.wordIndex(2200)).toBe(2);
    // A clock correction backwards holds the word rather than stepping back.
    expect(c.wordIndex(1600)).toBe(2);
    expect(new ClockFollower().wordIndex(0)).toBe(-1);
  });

  it('pauses, resumes and re-anchors on rate change', () => {
    const c = new ClockFollower();
    c.apply(started(0));
    c.apply({ type: 'PAUSED', sessionId: S, mediaTime: 1 });
    expect(c.paused).toBe(true);
    expect(c.mediaTime(99_999)).toBe(1);
    c.apply({ type: 'RESUMED', sessionId: S, mediaStartEpochMs: anchorFor(1, 10_000, 1) });
    expect(c.mediaTime(10_500)).toBeCloseTo(1.5);
    c.apply({ type: 'RATE_CHANGED', sessionId: S, rate: 2, mediaTime: 1.5, atEpochMs: 10_500 });
    expect(c.mediaTime(11_000)).toBeCloseTo(2.5);
    c.apply({ type: 'DRIFT', sessionId: S, mediaTime: 2.4, atEpochMs: 11_000 });
    expect(c.mediaTime(11_000)).toBeCloseTo(2.4);
  });

  it('applies corrections while paused and freezes on seek and end', () => {
    const c = new ClockFollower();
    c.apply(started(Date.now() - 1000));
    c.apply({ type: 'PAUSED', sessionId: S, mediaTime: 1 });
    c.apply({ type: 'RATE_CHANGED', sessionId: S, rate: 1.5, mediaTime: 1.1, atEpochMs: 0 });
    expect(c.mediaTime(0)).toBe(1.1);
    c.apply({ type: 'DRIFT', sessionId: S, mediaTime: 1.2, atEpochMs: 0 });
    expect(c.mediaTime(0)).toBe(1.2);
    const d = new ClockFollower();
    d.apply(started(Date.now()));
    d.apply({ type: 'SEEKED', sessionId: S });
    expect(d.paused).toBe(true);
    d.apply({ type: 'SEGMENT_ENDED', sessionId: S, segmentId: 'x' });
    expect(d.paused).toBe(true);
  });

  it('keeps drift within 50 ms over 10 minutes with rate changes and clock skew', () => {
    // The host's media clock runs 0.05% fast against the wall clock (audio hardware skew) and the
    // user changes speed every 37 s. The host sends DRIFT every 2 s (§4.3).
    const skew = 1.0005;
    const rates = [1, 1.5, 2.5, 0.75, 3.5, 1.25];
    const follower = new ClockFollower();
    let media = 0;
    let rate = 1;
    let wall = 0;
    follower.apply({ ...started(0, rate), words: [] });
    let maxErr = 0;
    const step = 10; // ms
    for (wall = step; wall <= 10 * 60 * 1000; wall += step) {
      media += (step / 1000) * rate * skew;
      if (wall % 37_000 === 0) {
        rate = rates[(wall / 37_000) % rates.length]!;
        follower.apply({
          type: 'RATE_CHANGED',
          sessionId: S,
          rate,
          mediaTime: media,
          atEpochMs: wall,
        });
      }
      if (wall % 2000 === 0)
        follower.apply({ type: 'DRIFT', sessionId: S, mediaTime: media, atEpochMs: wall });
      maxErr = Math.max(maxErr, Math.abs(follower.mediaTime(wall) - media));
    }
    expect(maxErr * 1000).toBeLessThan(50);
  });
});

describe('ClockFollower drift tracking (§9.1)', () => {
  it('measures steady-state drift apart from the start-up settle correction', () => {
    const c = new ClockFollower();
    c.apply(started(1000));
    // Chrome's clock settles ~65 ms late right after start: a settle correction absorbs it.
    c.apply({ type: 'DRIFT', sessionId: S, mediaTime: 0.235, atEpochMs: 1300, settle: true });
    expect(c.maxSettleMs).toBeCloseTo(65, 5);
    expect(c.maxDriftMs).toBe(0);
    // Later periodic corrections are small.
    c.apply({ type: 'DRIFT', sessionId: S, mediaTime: 1.937, atEpochMs: 3000 });
    expect(c.maxDriftMs).toBeCloseTo(2, 5);
    expect(c.driftSamples).toBe(1);
    expect(c.drifts).toHaveLength(1);
    // Other sessions and paused clocks are not compared.
    c.apply({ type: 'DRIFT', sessionId: 'other', mediaTime: 9, atEpochMs: 3100 });
    c.apply({ type: 'PAUSED', sessionId: S, mediaTime: 2 });
    c.apply({ type: 'DRIFT', sessionId: S, mediaTime: 5, atEpochMs: 3200 });
    expect(c.driftSamples).toBe(1);
  });
});

describe('ClockFollower between segments', () => {
  it('ignores clock corrections after a segment ended until the next one starts', () => {
    const c = new ClockFollower();
    c.apply(started(1000));
    c.apply({ type: 'SEGMENT_ENDED', sessionId: S, segmentId: 'p.0#0' });
    const held = c.mediaTime(Date.now());
    // The next segment's clock (≈ 0) must not rewind the previous segment's words.
    c.apply({ type: 'DRIFT', sessionId: S, mediaTime: 0.01, atEpochMs: 5000 });
    expect(c.mediaTime(Date.now())).toBe(held);
    c.apply(started(6000));
    c.apply({ type: 'DRIFT', sessionId: S, mediaTime: 1, atEpochMs: 7000 });
    expect(c.mediaTime(7000)).toBeCloseTo(1, 5);
  });
});
