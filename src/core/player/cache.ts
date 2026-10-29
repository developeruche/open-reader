/** Synthesis cache (PLAN.md §5.4.5): raw engine output keyed by everything that changes it. */
import type { WordTiming } from '../audio/timing';
import { sha256Hex } from '../util/sha256';

export interface CacheKeyParts {
  engineId: string;
  modelId: string;
  modelVersion: string;
  voiceId: string;
  speed: number;
  normalizerVersion: number;
  spokenText: string;
}

export interface CacheEntry {
  pcm: Int16Array;
  sampleRate: number;
  words?: WordTiming[];
  bytes: number;
  lastUsed: number;
}

export interface SynthesisCache {
  get(key: string): Promise<CacheEntry | undefined>;
  put(key: string, entry: Omit<CacheEntry, 'bytes' | 'lastUsed'>): Promise<void>;
  /** Total bytes stored. */
  size(): Promise<number>;
  clear(): Promise<void>;
  /** Changes the size cap and evicts down to it (least recently used first). */
  setCap?(bytes: number): Promise<void>;
  readonly stats: { hits: number; misses: number };
}

export function cacheKey(p: CacheKeyParts): string {
  return sha256Hex(
    [
      p.engineId,
      p.modelId,
      p.modelVersion,
      p.voiceId,
      p.speed.toFixed(3),
      p.normalizerVersion,
      p.spokenText,
    ].join('|'),
  );
}

export const entryBytes = (e: Pick<CacheEntry, 'pcm' | 'words'>) =>
  e.pcm.byteLength + (e.words?.length ?? 0) * 32 + 64;

export const DEFAULT_CACHE_CAP = 512 * 1024 * 1024;

/** In-memory LRU (used in tests and as a front layer over IndexedDB). */
export class MemoryCache implements SynthesisCache {
  private readonly map = new Map<string, CacheEntry>();
  private total = 0;
  readonly stats = { hits: 0, misses: 0 };

  constructor(
    private readonly capBytes = DEFAULT_CACHE_CAP,
    private readonly now: () => number = Date.now,
  ) {}

  async get(key: string) {
    const e = this.map.get(key);
    if (!e) {
      this.stats.misses++;
      return undefined;
    }
    this.stats.hits++;
    e.lastUsed = this.now();
    this.map.delete(key);
    this.map.set(key, e); // most recent last
    return e;
  }

  async put(key: string, entry: Omit<CacheEntry, 'bytes' | 'lastUsed'>) {
    const old = this.map.get(key);
    if (old) {
      this.total -= old.bytes;
      this.map.delete(key);
    }
    const full: CacheEntry = { ...entry, bytes: entryBytes(entry), lastUsed: this.now() };
    if (full.bytes > this.capBytes) return;
    this.map.set(key, full);
    this.total += full.bytes;
    for (const [k, v] of this.map) {
      if (this.total <= this.capBytes) break;
      this.map.delete(k);
      this.total -= v.bytes;
    }
  }

  async size() {
    return this.total;
  }

  async clear() {
    this.map.clear();
    this.total = 0;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }
}
