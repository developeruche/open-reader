import type { FileStore } from '@/core/models/downloader';

export class MemoryFileStore implements FileStore {
  readonly files = new Map<string, Uint8Array>();
  readonly parts = new Map<string, Uint8Array>();

  async partialSize(path: string) {
    return this.parts.get(path)?.length ?? 0;
  }
  async appender(path: string) {
    return {
      write: async (chunk: Uint8Array) => {
        const old = this.parts.get(path) ?? new Uint8Array(0);
        const next = new Uint8Array(old.length + chunk.length);
        next.set(old);
        next.set(chunk, old.length);
        this.parts.set(path, next);
      },
      close: async () => undefined,
    };
  }
  async discardPartial(path: string) {
    this.parts.delete(path);
  }
  async commit(path: string) {
    const p = this.parts.get(path);
    if (!p) throw new Error('nothing to commit');
    this.files.set(path, p);
    this.parts.delete(path);
  }
  async size(path: string) {
    return this.files.get(path)?.length;
  }
  async readPartial(path: string) {
    return (this.parts.get(path) ?? new Uint8Array(0)).slice().buffer;
  }
  async read(path: string) {
    const f = this.files.get(path);
    if (!f) throw new Error('missing');
    return f.slice().buffer;
  }
  async remove(path: string) {
    this.files.delete(path);
  }
  async removeDir(prefix: string) {
    for (const k of [...this.files.keys()]) if (k.startsWith(prefix)) this.files.delete(k);
  }
}
