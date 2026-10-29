import { describe, expect, it } from 'vitest';
import { isAbort } from '@/core/tts/engine';
import { PrefetchScheduler } from '@/core/player/scheduler';

function harness(concurrency = 1) {
  const started: string[] = [];
  const aborted: string[] = [];
  const pending = new Map<string, { resolve(v: string): void; reject(e: Error): void }>();
  const s = new PrefetchScheduler<string>(
    (key, signal) =>
      new Promise((resolve, reject) => {
        started.push(key);
        pending.set(key, { resolve, reject });
        signal.addEventListener('abort', () => {
          aborted.push(key);
          reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
        });
      }),
    concurrency,
    1,
  );
  const finish = async (key: string) => {
    pending.get(key)?.resolve(`audio:${key}`);
    await new Promise((r) => setTimeout(r, 0));
  };
  return { s, started, aborted, pending, finish };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('PrefetchScheduler', () => {
  it('runs jobs in distance order within the concurrency limit', async () => {
    const h = harness(1);
    h.s.want([
      { key: 'c', distance: 2 },
      { key: 'a', distance: 0 },
      { key: 'b', distance: 1 },
    ]);
    expect(h.started).toEqual(['a']);
    await h.finish('a');
    expect(h.started).toEqual(['a', 'b']);
    await h.finish('b');
    await h.finish('c');
    expect(h.started).toEqual(['a', 'b', 'c']);
    expect(h.s.peek('a')).toBe('audio:a');
    expect(h.s.isReady('c')).toBe(true);
    expect(h.s.snapshot()).toMatchObject({ ready: 3, running: 0, completed: 3 });
  });

  it('runs two jobs at once on WASM concurrency', () => {
    const h = harness(2);
    h.s.want([
      { key: 'a', distance: 0 },
      { key: 'b', distance: 1 },
      { key: 'c', distance: 2 },
    ]);
    expect(h.started).toEqual(['a', 'b']);
    h.s.setConcurrency(3);
    expect(h.started).toEqual(['a', 'b', 'c']);
  });

  it('cancels stale jobs on seek and rejects their waiters with AbortError', async () => {
    const h = harness(1);
    h.s.want([
      { key: 's1', distance: 0 },
      { key: 's2', distance: 1 },
    ]);
    const waiting = h.s.get('s2');
    h.s.want([{ key: 's40', distance: 0 }]); // seek far ahead
    expect(h.aborted).toEqual(['s1']);
    await expect(waiting).rejects.toSatisfy(isAbort);
    await tick();
    expect(h.started).toEqual(['s1', 's40']);
    expect(h.s.stats.aborted).toBe(2);
  });

  it('keeps a few played results behind the playhead and drops older ones', async () => {
    const h = harness(1);
    for (const k of ['a', 'b', 'c']) {
      h.s.want([{ key: k, distance: 0 }]);
      await h.finish(k);
    }
    // keepBehind = 1: only the most recently unwanted ready result survives.
    expect(h.s.isReady('a')).toBe(false);
    expect(h.s.isReady('b')).toBe(true);
    expect(h.s.isReady('c')).toBe(true);
  });

  it('get() queues unknown keys and surfaces failures; a later get retries', async () => {
    const h = harness(1);
    const p = h.s.get('x');
    expect(h.started).toEqual(['x']);
    h.pending.get('x')!.reject(new Error('boom'));
    await expect(p).rejects.toThrow('boom');
    const again = h.s.get('x');
    expect(h.started).toEqual(['x', 'x']);
    await h.finish('x');
    await expect(again).resolves.toBe('audio:x');
    h.s.want([]);
    h.s.want([{ key: 'y', distance: 0 }]);
    h.s.reset();
    expect(h.aborted).toContain('y');
  });

  it('drops failed slots that are no longer wanted', async () => {
    const h = harness(1);
    const p = h.s.get('f');
    h.pending.get('f')!.reject(new Error('nope'));
    await expect(p).rejects.toThrow();
    h.s.want([]);
    expect(h.s.snapshot().ready).toBe(0);
  });
});
