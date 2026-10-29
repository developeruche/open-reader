/** User pronunciations in IndexedDB (`open-reader` → `lexicon`). */
import type { IDBPDatabase } from 'idb';
import { StoredEntrySchema, type StoredEntry } from '@/core/text/lexicon';
import { DB_NAME, openReaderDb, type OpenReaderDB } from './audioCache';

export class IdbLexicon {
  private readonly db: Promise<IDBPDatabase<OpenReaderDB>>;

  constructor(dbName = DB_NAME) {
    this.db = openReaderDb(dbName);
  }

  async list(): Promise<StoredEntry[]> {
    const rows = await (await this.db).getAll('lexicon');
    return rows.flatMap((r) => {
      const p = StoredEntrySchema.safeParse(r);
      return p.success ? [p.data] : [];
    });
  }

  async put(entry: StoredEntry): Promise<void> {
    await (await this.db).put('lexicon', StoredEntrySchema.parse(entry));
  }

  async remove(id: string): Promise<void> {
    await (await this.db).delete('lexicon', id);
  }

  /** Replaces every entry (import with "replace"). */
  async replaceAll(entries: StoredEntry[]): Promise<void> {
    const db = await this.db;
    const tx = db.transaction('lexicon', 'readwrite');
    await tx.store.clear();
    for (const e of entries) await tx.store.put(StoredEntrySchema.parse(e));
    await tx.done;
  }
}
