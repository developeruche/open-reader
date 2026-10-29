/**
 * Audiobook export plumbing for an engine host (ADR 0019): OPFS scratch/output files, the LAME
 * MP3 encoder (its WASM ships as a separate, replaceable file: LAME is LGPL), and blob URLs.
 */
import { createEncoder } from 'wasm-media-encoders';
import mp3WasmUrl from 'wasm-media-encoders/wasm/mp3?url';
import type { HostRuntimeDeps } from '@/runtime/hostRuntime';
import { opfsFile, opfsRemove, opfsWriter } from './opfs';

let wasm: Promise<ArrayBuffer> | undefined;

export function createExporter(): NonNullable<HostRuntimeDeps['exporter']> {
  return {
    store: {
      appender: opfsWriter,
      async slice(path, start, end) {
        const f = await opfsFile(path);
        if (!f) throw new Error(`Missing ${path}`);
        return f.slice(start, end).arrayBuffer();
      },
      remove: opfsRemove,
    },
    async mp3(sampleRate, kbps) {
      wasm ??= fetch(mp3WasmUrl).then((r) => r.arrayBuffer());
      const e = await createEncoder('audio/mpeg', await wasm);
      e.configure({ sampleRate, channels: 1, bitrate: kbps as 64 });
      return { encode: (pcm) => e.encode([pcm]), finalize: () => e.finalize() };
    },
    async url(path) {
      const f = await opfsFile(path);
      if (!f) throw new Error(`Missing ${path}`);
      return URL.createObjectURL(f);
    },
    async release(url, path) {
      URL.revokeObjectURL(url);
      await opfsRemove(path);
    },
  };
}
