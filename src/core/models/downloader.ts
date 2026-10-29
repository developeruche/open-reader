/**
 * Resumable, verified model downloads (PLAN.md §6.7). Pure: storage, fetch and hashing are
 * injected so the logic is unit-tested with mocked streams and corrupted chunks.
 */
import type { ModelFileSchema } from '../tts/registry';
import type { z } from 'zod';

export type ModelFile = z.infer<typeof ModelFileSchema>;

/** File storage with append-only partial files (OPFS in the extension). */
export interface FileStore {
  /** Bytes already stored for an unfinished download, 0 if none. */
  partialSize(path: string): Promise<number>;
  /** Opens the partial file for appending (one handle per download). */
  appender(
    path: string,
  ): Promise<{ write(chunk: Uint8Array): Promise<void>; close(): Promise<void> }>;
  /** Discards a partial download. */
  discardPartial(path: string): Promise<void>;
  /** Moves the completed partial into place. */
  commit(path: string): Promise<void>;
  /** Size of a committed file, or undefined. */
  size(path: string): Promise<number | undefined>;
  readPartial(path: string): Promise<ArrayBuffer>;
  read(path: string): Promise<ArrayBuffer>;
  remove(path: string): Promise<void>;
  removeDir(prefix: string): Promise<void>;
}

export type Fetcher = (
  url: string,
  init: { headers: Record<string, string>; signal?: AbortSignal },
) => Promise<Response>;
export type Hasher = (data: ArrayBuffer) => Promise<string>;

export interface DownloadProgress {
  path: string;
  loaded: number;
  total: number;
}

export class IntegrityError extends Error {
  constructor(
    readonly path: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(`Checksum mismatch for ${path}`);
    this.name = 'IntegrityError';
  }
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    url: string,
  ) {
    super(`Download failed (${status}) for ${url}`);
    this.name = 'HttpError';
  }
}

export interface DownloadOptions {
  store: FileStore;
  fetch: Fetcher;
  hash: Hasher;
  onProgress?(p: DownloadProgress): void;
  signal?: AbortSignal;
  /** Alternative source tried first (offline pack bundled in the extension). */
  localUrl?: string;
}

/** Downloads one file into `dest`, resuming a partial download, then verifies SHA-256. */
export async function downloadFile(
  file: ModelFile,
  dest: string,
  o: DownloadOptions,
): Promise<void> {
  const existing = await o.store.size(dest);
  if (existing === file.bytes) return; // already installed
  let have = await o.store.partialSize(dest);
  if (have > file.bytes) {
    await o.store.discardPartial(dest);
    have = 0;
  }
  if (have < file.bytes) {
    let res: Response | undefined;
    if (o.localUrl) {
      res = await o.fetch(o.localUrl, { headers: {}, signal: o.signal }).catch(() => undefined);
      if (res && !res.ok) res = undefined;
      if (res && have > 0) {
        await o.store.discardPartial(dest);
        have = 0;
      }
    }
    if (!res) {
      res = await o.fetch(file.url, {
        headers: have > 0 ? { Range: `bytes=${have}-` } : {},
        signal: o.signal,
      });
      if (res.status === 200 && have > 0) {
        // The server ignored the range: start over.
        await o.store.discardPartial(dest);
        have = 0;
      } else if (res.status !== 200 && res.status !== 206) {
        throw new HttpError(res.status, file.url);
      }
    }
    if (!res.body) throw new HttpError(res.status, file.url);
    const reader = res.body.getReader();
    const out = await o.store.appender(dest);
    let loaded = have;
    o.onProgress?.({ path: dest, loaded, total: file.bytes });
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        await out.write(value);
        loaded += value.byteLength;
        o.onProgress?.({ path: dest, loaded, total: file.bytes });
      }
    } finally {
      // Keep what arrived so a later attempt resumes from here (pause, network loss).
      await out.close();
    }
    if (loaded !== file.bytes) {
      if (loaded > file.bytes) await o.store.discardPartial(dest);
      throw new Error(`Incomplete download for ${dest}: ${loaded} of ${file.bytes} bytes`);
    }
  }
  const actual = await o.hash(await o.store.readPartial(dest));
  if (actual !== file.sha256) {
    await o.store.discardPartial(dest);
    throw new IntegrityError(dest, file.sha256, actual);
  }
  await o.store.commit(dest);
}
