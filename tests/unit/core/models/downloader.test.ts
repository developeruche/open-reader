import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  downloadFile,
  downloadWithRetry,
  HttpError,
  isTransient,
  IntegrityError,
  type Fetcher,
  type ModelFile,
} from '@/core/models/downloader';
import { filePath, filesFor, INSTALLED_KEY, ModelManager } from '@/core/models/manager';
import { ModelManifestSchema, RegistrySchema } from '@/core/tts/registry';
import { memoryStore } from '@/core/util/kv';
import registry from '../../../../models/registry.json';
import { MemoryFileStore } from '../../helpers/memoryFileStore';

const hash = async (b: ArrayBuffer) => createHash('sha256').update(new Uint8Array(b)).digest('hex');
const bytes = (n: number, seed = 1) =>
  Uint8Array.from({ length: n }, (_, i) => (i * 31 + seed) & 0xff);
const sha = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');

/** A fake server that streams `data` in chunks, honours Range, and can misbehave. */
function server(
  data: Uint8Array,
  o: {
    chunk?: number;
    ignoreRange?: boolean;
    failAfter?: number;
    corruptAt?: number;
    status?: number;
  } = {},
) {
  const calls: { url: string; range?: string }[] = [];
  const fetch: Fetcher = async (url, init) => {
    calls.push({ url, range: init.headers.Range });
    if (o.status) return new Response(null, { status: o.status });
    const start =
      !o.ignoreRange && init.headers.Range
        ? Number(/bytes=(\d+)-/.exec(init.headers.Range)?.[1] ?? 0)
        : 0;
    let body = data.slice(start);
    if (o.corruptAt !== undefined) {
      body = body.slice();
      body[o.corruptAt] = (body[o.corruptAt] ?? 0) ^ 0xff;
    }
    const size = o.chunk ?? 1000;
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(c) {
        if (o.failAfter !== undefined && sent >= o.failAfter)
          return c.error(new TypeError('network error'));
        if (sent >= body.length) return c.close();
        c.enqueue(body.slice(sent, sent + size));
        sent += size;
      },
    });
    return new Response(stream, { status: start > 0 ? 206 : 200 });
  };
  return { fetch, calls };
}

const fileOf = (data: Uint8Array): ModelFile => ({
  path: 'onnx/model.onnx',
  url: 'https://hf.test/model.onnx',
  sha256: sha(data),
  bytes: data.length,
});

describe('downloadWithRetry', () => {
  it('retries transient failures with backoff and resumes from what arrived', async () => {
    const data = bytes(5000);
    let call = 0;
    const flaky = server(data, { failAfter: 2000 });
    const good = server(data);
    const fetch: Fetcher = (url, init) =>
      call++ === 0 ? flaky.fetch(url, init) : good.fetch(url, init);
    const store = new MemoryFileStore();
    const waits: number[] = [];
    await downloadWithRetry(
      fileOf(data),
      'm/f',
      { store, fetch, hash },
      { baseMs: 100, sleep: async (ms) => void waits.push(ms) },
    );
    expect(waits).toEqual([100]);
    expect(good.calls[0]?.range).toBe('bytes=2000-');
    expect(await store.size('m/f')).toBe(5000);
  });

  it('gives up after the last attempt and never retries permanent errors', async () => {
    const data = bytes(100);
    const waits: number[] = [];
    const sleep = async (ms: number) => void waits.push(ms);
    await expect(
      downloadWithRetry(
        fileOf(data),
        'm/a',
        { store: new MemoryFileStore(), fetch: server(data, { status: 503 }).fetch, hash },
        { attempts: 3, baseMs: 10, sleep },
      ),
    ).rejects.toBeInstanceOf(HttpError);
    expect(waits).toEqual([10, 20]);
    waits.length = 0;
    await expect(
      downloadWithRetry(
        fileOf(data),
        'm/b',
        { store: new MemoryFileStore(), fetch: server(data, { status: 404 }).fetch, hash },
        { sleep },
      ),
    ).rejects.toBeInstanceOf(HttpError);
    await expect(
      downloadWithRetry(
        fileOf(data),
        'm/c',
        { store: new MemoryFileStore(), fetch: server(data, { corruptAt: 3 }).fetch, hash },
        { sleep },
      ),
    ).rejects.toBeInstanceOf(IntegrityError);
    expect(waits).toEqual([]);
  });

  it('classifies errors', () => {
    expect(isTransient(new TypeError('network'))).toBe(true);
    expect(isTransient(new HttpError(429, 'u'))).toBe(true);
    expect(isTransient(new HttpError(403, 'u'))).toBe(false);
    expect(isTransient(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(false);
    expect(isTransient('nope')).toBe(false);
  });
});

describe('downloadFile', () => {
  it('streams, reports progress, verifies and commits', async () => {
    const data = bytes(5500);
    const store = new MemoryFileStore();
    const progress: number[] = [];
    await downloadFile(fileOf(data), 'm/f', {
      store,
      fetch: server(data).fetch,
      hash,
      onProgress: (p) => progress.push(p.loaded),
    });
    expect(store.files.get('m/f')).toEqual(data);
    expect(progress.at(-1)).toBe(5500);
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
  });

  it('resumes a partial download with a Range request', async () => {
    const data = bytes(5000);
    const store = new MemoryFileStore();
    const flaky = server(data, { failAfter: 2000 });
    await expect(
      downloadFile(fileOf(data), 'm/f', { store, fetch: flaky.fetch, hash }),
    ).rejects.toThrow('network error');
    expect(await store.partialSize('m/f')).toBe(2000);
    const good = server(data);
    await downloadFile(fileOf(data), 'm/f', { store, fetch: good.fetch, hash });
    expect(good.calls[0]!.range).toBe('bytes=2000-');
    expect(store.files.get('m/f')).toEqual(data);
  });

  it('starts over when the server ignores Range', async () => {
    const data = bytes(3000);
    const store = new MemoryFileStore();
    await (await store.appender('m/f')).write(data.slice(0, 1000));
    const s = server(data, { ignoreRange: true });
    await downloadFile(fileOf(data), 'm/f', { store, fetch: s.fetch, hash });
    expect(store.files.get('m/f')).toEqual(data);
  });

  it('rejects a corrupted download and discards it', async () => {
    const data = bytes(4000);
    const store = new MemoryFileStore();
    const err = await downloadFile(fileOf(data), 'm/f', {
      store,
      fetch: server(data, { corruptAt: 1234 }).fetch,
      hash,
    }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(IntegrityError);
    expect(store.parts.has('m/f')).toBe(false);
    expect(store.files.has('m/f')).toBe(false);
  });

  it('rejects a corrupted partial chunk from an earlier attempt', async () => {
    const data = bytes(4000);
    const store = new MemoryFileStore();
    await (await store.appender('m/f')).write(bytes(1500, 9)); // wrong bytes on disk
    await expect(
      downloadFile(fileOf(data), 'm/f', { store, fetch: server(data).fetch, hash }),
    ).rejects.toBeInstanceOf(IntegrityError);
    await downloadFile(fileOf(data), 'm/f', { store, fetch: server(data).fetch, hash });
    expect(store.files.get('m/f')).toEqual(data);
  });

  it('fails on HTTP errors, short bodies and oversized partials', async () => {
    const data = bytes(2000);
    const store = new MemoryFileStore();
    await expect(
      downloadFile(fileOf(data), 'm/f', {
        store,
        fetch: server(data, { status: 404 }).fetch,
        hash,
      }),
    ).rejects.toBeInstanceOf(HttpError);
    await expect(
      downloadFile({ ...fileOf(data), bytes: 3000 }, 'm/f', {
        store,
        fetch: server(data).fetch,
        hash,
      }),
    ).rejects.toThrow('Incomplete');
    store.parts.set('m/g', bytes(5000));
    await downloadFile(fileOf(data), 'm/g', { store, fetch: server(data).fetch, hash });
    expect(store.files.get('m/g')).toEqual(data);
    await expect(
      downloadFile({ ...fileOf(data), bytes: 1000 }, 'm/h', {
        store,
        fetch: server(data).fetch,
        hash,
      }),
    ).rejects.toThrow('Incomplete');
    expect(store.parts.has('m/h')).toBe(false);
  });

  it('is a no-op when already installed, and prefers a bundled copy', async () => {
    const data = bytes(1000);
    const store = new MemoryFileStore();
    store.files.set('m/f', data);
    const s = server(data);
    await downloadFile(fileOf(data), 'm/f', { store, fetch: s.fetch, hash });
    expect(s.calls).toHaveLength(0);
    const local = server(data);
    store.parts.set('m/x', data.slice(0, 10));
    await downloadFile(fileOf(data), 'm/x', {
      store,
      fetch: local.fetch,
      hash,
      localUrl: 'chrome-extension://id/models/x',
    });
    expect(local.calls[0]!.url).toBe('chrome-extension://id/models/x');
    expect(store.files.get('m/x')).toEqual(data);
  });

  it('pausing (abort) keeps the partial for a later resume', async () => {
    const data = bytes(10_000);
    const store = new MemoryFileStore();
    const ac = new AbortController();
    const slow: Fetcher = async (url, init) => {
      const r = await server(data, { chunk: 500 }).fetch(url, init);
      const reader = r.body!.getReader();
      let n = 0;
      return new Response(
        new ReadableStream({
          async pull(c) {
            if (++n === 5) ac.abort();
            if (init.signal?.aborted) return c.error(new DOMException('Aborted', 'AbortError'));
            const { value, done } = await reader.read();
            if (done) c.close();
            else c.enqueue(value);
          },
        }),
        { status: r.status },
      );
    };
    await expect(
      downloadFile(fileOf(data), 'm/f', { store, fetch: slow, hash, signal: ac.signal }),
    ).rejects.toThrow();
    expect(await store.partialSize('m/f')).toBe(2000);
  });
});

describe('ModelManager', () => {
  const data = { model: bytes(3000, 2), webgpu: bytes(4000, 3), voice: bytes(500, 4) };
  const model = ModelManifestSchema.parse({
    id: 'kokoro-test',
    engine: 'kokoro',
    displayName: 'K',
    version: '1',
    license: { spdx: 'Apache-2.0', url: 'https://x.test' },
    sizeBytes: 7500,
    sampleRate: 24000,
    files: [
      {
        path: 'onnx/q8.onnx',
        url: 'https://hf.test/q8',
        sha256: sha(data.model),
        bytes: 3000,
        backend: 'wasm',
      },
      {
        path: 'onnx/fp32.onnx',
        url: 'https://hf.test/fp32',
        sha256: sha(data.webgpu),
        bytes: 4000,
        backend: 'webgpu',
      },
      { path: 'voices/a.bin', url: 'https://hf.test/a', sha256: sha(data.voice), bytes: 500 },
    ],
    voices: [{ id: 'a', name: 'A', lang: 'en' }],
    defaultVoice: 'a',
    caps: { wordTimings: 'native', backends: ['webgpu', 'wasm'] },
  });
  const fetch: Fetcher = async (url, init) => {
    const d = url.endsWith('q8') ? data.model : url.endsWith('fp32') ? data.webgpu : data.voice;
    return server(d).fetch(url, init);
  };

  it('installs only the files for a backend, then the other on demand', async () => {
    const store = new MemoryFileStore();
    const kv = memoryStore();
    const m = new ModelManager({ store, kv, fetch, hash, now: () => 42 });
    expect(filesFor(model, 'wasm').map((f) => f.path)).toEqual(['onnx/q8.onnx', 'voices/a.bin']);
    const progress: number[] = [];
    await m.install(model, 'wasm', { onProgress: (p) => progress.push(p.loaded / p.total) });
    expect(progress.at(-1)).toBe(1);
    expect(await m.isInstalled(model, 'wasm')).toBe(true);
    expect(await m.isInstalled(model, 'webgpu')).toBe(false);
    expect(store.files.has(filePath(model, { path: 'onnx/fp32.onnx' }))).toBe(false);
    await m.install(model, 'webgpu');
    expect(await m.isInstalled(model, 'webgpu')).toBe(true);
    expect((await m.installed())[model.id]).toMatchObject({ backend: 'any', installedAt: 42 });
    expect((await m.installed())[model.id]!.files).toHaveLength(3);
  });

  it('verifies, repairs corrupted files and removes models', async () => {
    const store = new MemoryFileStore();
    const kv = memoryStore();
    const m = new ModelManager({ store, kv, fetch, hash });
    expect(await m.verify(model)).toHaveLength(3);
    await m.install(model, 'wasm');
    expect(await m.verify(model, true)).toEqual([]);
    const p = filePath(model, { path: 'onnx/q8.onnx' });
    const bad = store.files.get(p)!.slice();
    bad[10] = (bad[10] ?? 0) ^ 0xff;
    store.files.set(p, bad);
    expect(await m.verify(model)).toEqual([]); // sizes still match
    expect(await m.verify(model, true)).toEqual(['onnx/q8.onnx']);
    expect(await m.repair(model)).toEqual(['onnx/q8.onnx']);
    expect(await m.verify(model, true)).toEqual([]);
    store.files.delete(filePath(model, { path: 'voices/a.bin' }));
    expect(await m.verify(model)).toEqual(['voices/a.bin']);
    await m.remove(model);
    expect(await kv.get(INSTALLED_KEY)).toEqual({});
    expect(store.files.size).toBe(0);
    expect(await m.isInstalled(model)).toBe(false);
  });
});

describe('bundled registry', () => {
  it('validates and pins every file to a revision with a hash', () => {
    const r = RegistrySchema.parse(registry);
    expect(r.models.map((m) => m.id)).toContain('kokoro-82m-v1-timestamped');
    for (const m of r.models) {
      for (const f of m.files) expect(f.url).toMatch(/\/resolve\/[0-9a-f]{40}\//);
      expect(m.sizeBytes).toBe(m.files.reduce((a, f) => a + f.bytes, 0));
    }
    const kokoro = r.models.find((m) => m.engine === 'kokoro')!;
    expect(filesFor(kokoro, 'webgpu').some((f) => f.path === 'onnx/model.onnx')).toBe(true);
    expect(filesFor(kokoro, 'wasm').some((f) => f.path === 'onnx/model_quantized.onnx')).toBe(true);
    for (const m of r.models.filter((x) => x.id.includes('lessac')))
      expect(m.license.personalUseOnly).toBe(true);
  });
});
