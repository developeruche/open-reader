import type { ReadingPosition } from '@/core/document/model';
/** IndexedDB synthesis cache (`open-reader` db, `audio` store) with LRU eviction by bytes. */
import { openDB, type DBSchema, type IDBPDatabase } from 'idb';
import {
  DEFAULT_CACHE_CAP,
  entryBytes,
  type CacheEntry,
  type SynthesisCache,
} from '@/core/player/cache';

interface AudioRow extends CacheEntry {
  key: string;
}

export interface LibraryRow {
  docId: string;
  title: string;
  kind: 'web' | 'pdf';
  url?: string;
  position: ReadingPosition;
  updatedAt: number;
}

export interface OpenReaderDB extends DBSchema {
  audio: { key: string; value: AudioRow; indexes: { lastUsed: number } };
  meta: { key: string; value: number };
  library: { key: string; value: LibraryRow; indexes: { updatedAt: number } };
}

export const DB_NAME = 'open-reader';
export const DB_VERSION = 2;

export function openReaderDb(name = DB_NAME): Promise<IDBPDatabase<OpenReaderDB>> {
  return openDB<OpenReaderDB>(name, DB_VERSION, {
    upgrade(db, oldVersion) {
      if (oldVersion < 1) {
        const audio = db.createObjectStore('audio', { keyPath: 'key' });
        audio.createIndex('lastUsed', 'lastUsed');
        db.createObjectStore('meta');
      }
      if (oldVersion < 2) {
        const library = db.createObjectStore('library', { keyPath: 'docId' });
        library.createIndex('updatedAt', 'updatedAt');
      }
    },
  });
}

export class IdbSynthesisCache implements SynthesisCache {
  readonly stats = { hits: 0, misses: 0 };
  private readonly db: Promise<IDBPDatabase<OpenReaderDB>>;

  constructor(
    private capBytes = DEFAULT_CACHE_CAP,
    dbName = DB_NAME,
    private readonly now: () => number = Date.now,
  ) {
    this.db = openReaderDb(dbName);
  }

  setCap(bytes: number): Promise<void> {
    this.capBytes = bytes;
    return this.evict();
  }

  async get(key: string): Promise<CacheEntry | undefined> {
    const db = await this.db;
    const row = await db.get('audio', key);
    if (!row) {
      this.stats.misses++;
      return undefined;
    }
    this.stats.hits++;
    row.lastUsed = this.now();
    await db.put('audio', row);
    const { key: _k, ...entry } = row;
    return entry;
  }

  async put(key: string, entry: Omit<CacheEntry, 'bytes' | 'lastUsed'>): Promise<void> {
    const bytes = entryBytes(entry);
    if (bytes > this.capBytes) return;
    const db = await this.db;
    const tx = db.transaction(['audio', 'meta'], 'readwrite');
    const old = await tx.objectStore('audio').get(key);
    const total = ((await tx.objectStore('meta').get('bytes')) ?? 0) - (old?.bytes ?? 0) + bytes;
    await tx.objectStore('audio').put({ ...entry, key, bytes, lastUsed: this.now() });
    await tx.objectStore('meta').put(total, 'bytes');
    await tx.done;
    if (total > this.capBytes) await this.evict();
  }

  async size(): Promise<number> {
    return (await (await this.db).get('meta', 'bytes')) ?? 0;
  }

  async count(): Promise<number> {
    return (await this.db).count('audio');
  }

  async clear(): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['audio', 'meta'], 'readwrite');
    await tx.objectStore('audio').clear();
    await tx.objectStore('meta').put(0, 'bytes');
    await tx.done;
  }

  /** Deletes least-recently-used rows until the total fits the cap. */
  private async evict(): Promise<void> {
    const db = await this.db;
    const tx = db.transaction(['audio', 'meta'], 'readwrite');
    let total = (await tx.objectStore('meta').get('bytes')) ?? 0;
    let cursor = await tx.objectStore('audio').index('lastUsed').openCursor();
    while (cursor && total > this.capBytes) {
      total -= cursor.value.bytes;
      await cursor.delete();
      cursor = await cursor.continue();
    }
    await tx.objectStore('meta').put(Math.max(0, total), 'bytes');
    await tx.done;
  }
}
