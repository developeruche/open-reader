/** OCR results per document page in IndexedDB, so a scanned PDF is recognized once. */
import type { IDBPDatabase } from 'idb';
import type { PdfItem } from '@/pdf/layout';
import { OCR_VERSION } from '@/pdf/ocr';
import { DB_NAME, openReaderDb, type OpenReaderDB } from './audioCache';

const key = (docId: string, page: number) => `${docId}:${page}:${OCR_VERSION}`;

export class IdbOcrCache {
  private readonly db: Promise<IDBPDatabase<OpenReaderDB>>;

  constructor(dbName = DB_NAME) {
    this.db = openReaderDb(dbName);
  }

  async get(docId: string, page: number): Promise<PdfItem[] | undefined> {
    return (await (await this.db).get('ocr', key(docId, page)))?.items;
  }

  async put(docId: string, page: number, items: PdfItem[]): Promise<void> {
    await (await this.db).put('ocr', { key: key(docId, page), items });
  }
}
