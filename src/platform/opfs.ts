/** OPFS-backed FileStore for model weights and stored PDFs (PLAN.md §4.4). */
import type { FileStore } from '@/core/models/downloader';

const PART = '.part';

async function dirFor(
  path: string,
  create: boolean,
): Promise<{ dir: FileSystemDirectoryHandle; name: string }> {
  const parts = path.split('/').filter(Boolean);
  const name = parts.pop() ?? '';
  let dir = await navigator.storage.getDirectory();
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create });
  return { dir, name };
}

async function fileHandle(path: string, create = false): Promise<FileSystemFileHandle | undefined> {
  try {
    const { dir, name } = await dirFor(path, create);
    return await dir.getFileHandle(name, { create });
  } catch {
    return undefined;
  }
}

/** `FileSystemDirectoryHandle.values()` is missing from TypeScript's DOM lib. */
interface AsyncDirectory {
  values(): AsyncIterable<FileSystemHandle>;
}

export class OpfsStore implements FileStore {
  async partialSize(path: string): Promise<number> {
    return (await (await fileHandle(path + PART))?.getFile())?.size ?? 0;
  }

  async appender(path: string) {
    const h = await fileHandle(path + PART, true);
    if (!h) throw new Error(`Cannot write ${path}`);
    const size = (await h.getFile()).size;
    const w = await h.createWritable({ keepExistingData: true });
    await w.seek(size);
    return {
      write: (chunk: Uint8Array) => w.write(chunk as Uint8Array<ArrayBuffer>),
      close: () => w.close(),
    };
  }

  async discardPartial(path: string): Promise<void> {
    await this.remove(path + PART);
  }

  async commit(path: string): Promise<void> {
    const part = await fileHandle(path + PART);
    if (!part) throw new Error(`Nothing to commit for ${path}`);
    await this.remove(path);
    const { name } = await dirFor(path, true);
    await (part as FileSystemFileHandle & { move(name: string): Promise<void> }).move(name);
  }

  async size(path: string): Promise<number | undefined> {
    return (await (await fileHandle(path))?.getFile())?.size;
  }

  async readPartial(path: string): Promise<ArrayBuffer> {
    return this.read(path + PART);
  }

  async read(path: string): Promise<ArrayBuffer> {
    const h = await fileHandle(path);
    if (!h) throw new Error(`Missing file ${path}`);
    return (await h.getFile()).arrayBuffer();
  }

  /** A File (lazy Blob) without reading it into memory. */
  async file(path: string): Promise<File | undefined> {
    return (await fileHandle(path))?.getFile();
  }

  async remove(path: string): Promise<void> {
    try {
      const { dir, name } = await dirFor(path, false);
      await dir.removeEntry(name);
    } catch {
      // already gone
    }
  }

  /** Total bytes of the files directly inside `prefix`. */
  async dirSize(prefix: string): Promise<number> {
    try {
      const { dir, name } = await dirFor(prefix, false);
      const sub = await dir.getDirectoryHandle(name);
      let total = 0;
      for await (const h of (sub as unknown as AsyncDirectory).values())
        if (h.kind === 'file') total += (await (h as FileSystemFileHandle).getFile()).size;
      return total;
    } catch {
      return 0;
    }
  }

  async removeDir(prefix: string): Promise<void> {
    try {
      const { dir, name } = await dirFor(prefix, false);
      await dir.removeEntry(name, { recursive: true });
    } catch {
      // already gone
    }
  }
}

export async function sha256Subtle(data: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Storage usage, quota and persistence for the Storage page. */
export async function storageStatus(): Promise<{
  usage: number;
  quota: number;
  persisted: boolean;
}> {
  const [e, persisted] = await Promise.all([
    navigator.storage.estimate(),
    navigator.storage.persisted(),
  ]);
  return { usage: e.usage ?? 0, quota: e.quota ?? 0, persisted };
}

export async function requestPersistence(): Promise<boolean> {
  return navigator.storage.persist();
}
