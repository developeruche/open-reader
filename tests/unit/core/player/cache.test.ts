import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { cacheKey, entryBytes, MemoryCache, type CacheKeyParts } from '@/core/player/cache';
import { IdbSynthesisCache } from '@/platform/audioCache';

const parts: CacheKeyParts = {
  engineId: 'kokoro',
  modelId: 'k',
  modelVersion: '1',
  voiceId: 'af_heart',
  speed: 1,
  normalizerVersion: 1,
  spokenText: 'Hello.',
};
const entry = (n: number) => ({ pcm: new Int16Array(n), sampleRate: 24000, words: [] });

describe('cacheKey', () => {
  it('is a stable sha256 that changes with every field', async () => {
    const k = cacheKey(parts);
    expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(cacheKey({ ...parts })).toBe(k);
    for (const patch of [
      { engineId: 'piper' },
      { modelId: 'x' },
      { modelVersion: '2' },
      { voiceId: 'v' },
      { speed: 1.25 },
      { normalizerVersion: 2 },
      { spokenText: 'Hello!' },
    ]) {
      expect(cacheKey({ ...parts, ...patch })).not.toBe(k);
    }
  });
});

describe('MemoryCache LRU', () => {
  it('evicts least recently used entries over the byte cap', async () => {
    let t = 0;
    const cap = entryBytes(entry(1000)) * 3;
    const c = new MemoryCache(cap, () => ++t);
    await c.put('a', entry(1000));
    await c.put('b', entry(1000));
    await c.put('c', entry(1000));
    await c.get('a'); // a is now most recent
    await c.put('d', entry(1000));
    expect(c.keys()).toEqual(['c', 'a', 'd']);
    expect(await c.get('b')).toBeUndefined();
    expect(c.stats).toEqual({ hits: 1, misses: 1 });
    expect(await c.size()).toBe(cap);
  });

  it('replaces existing keys, skips oversized entries and clears', async () => {
    const c = new MemoryCache(entryBytes(entry(10)) * 2);
    await c.put('a', entry(10));
    await c.put('a', entry(10));
    expect(c.keys()).toEqual(['a']);
    await c.put('huge', entry(10_000));
    expect(await c.get('huge')).toBeUndefined();
    await c.clear();
    expect(await c.size()).toBe(0);
  });
});

describe('IdbSynthesisCache', () => {
  it('stores, reads and evicts by last use', async () => {
    let t = 0;
    const one = entryBytes(entry(500));
    const c = new IdbSynthesisCache(one * 2, `test-${Math.random()}`, () => ++t);
    await c.put('a', entry(500));
    await c.put('b', entry(500));
    expect((await c.get('a'))?.pcm.length).toBe(500);
    await c.put('c', entry(500));
    expect(await c.get('b')).toBeUndefined();
    expect(await c.get('a')).toBeTruthy();
    expect(await c.count()).toBe(2);
    expect(await c.size()).toBe(one * 2);
    await c.put('a', entry(500)); // replace keeps the total right
    expect(await c.size()).toBe(one * 2);
    await c.put('huge', entry(100_000));
    expect(await c.count()).toBe(2);
    await c.setCap(one);
    expect(await c.count()).toBe(1);
    await c.clear();
    expect(await c.size()).toBe(0);
    expect(c.stats.hits).toBeGreaterThan(0);
  });
});
