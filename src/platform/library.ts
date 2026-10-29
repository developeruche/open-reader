/** Library of recent documents with their last reading position (IndexedDB `library`). */
import type { IDBPDatabase } from 'idb';
import type { ReadingDocument, ReadingPosition } from '@/core/document/model';
import type { LibraryStore } from '@/runtime/orchestrator';
import { DB_NAME, openReaderDb, type LibraryRow, type OpenReaderDB } from './audioCache';

export class IdbLibrary implements LibraryStore {
  private readonly db: Promise<IDBPDatabase<OpenReaderDB>>;

  constructor(dbName = DB_NAME) {
    this.db = openReaderDb(dbName);
  }

  async savePosition(
    position: ReadingPosition,
    meta: { title: string; url?: string; kind: ReadingDocument['kind'] },
  ): Promise<void> {
    const db = await this.db;
    const old = await db.get('library', position.docId);
    const row: LibraryRow = {
      docId: position.docId,
      title: meta.title || old?.title || '',
      kind: meta.kind,
      url: meta.url ?? old?.url,
      position,
      updatedAt: position.updatedAt,
    };
    await db.put('library', row);
  }

  async getPosition(docId: string): Promise<ReadingPosition | undefined> {
    return (await (await this.db).get('library', docId))?.position;
  }

  async recent(limit = 20): Promise<LibraryRow[]> {
    const rows = await (await this.db).getAllFromIndex('library', 'updatedAt');
    return rows.reverse().slice(0, limit);
  }
}
