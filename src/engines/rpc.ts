/**
 * Worker RPC for render engines (comlink). Engines run inside a dedicated worker; the host talks to
 * them through this proxy. AbortSignals can't cross threads, so cancellation is by request id.
 */
import * as Comlink from 'comlink';
import {
  AbortError,
  type InitOptions,
  type RenderEngine,
  type SynthesisRequest,
  type SynthesisResult,
} from '@/core/tts/engine';
import type { ModelManifest, VoiceInfo } from '@/core/tts/registry';

export interface EngineWorkerApi {
  init(model: ModelManifest, backend: InitOptions['backend']): Promise<{ backend: string }>;
  voices(): Promise<VoiceInfo[]>;
  synthesize(id: number, req: SynthesisRequest): Promise<SynthesisResult>;
  cancel(id: number): void;
  dispose(): Promise<void>;
}

/** Worker side: exposes an engine on `endpoint` (self in a worker). */
export function exposeEngine(engine: RenderEngine, endpoint: Comlink.Endpoint): void {
  const running = new Map<number, AbortController>();
  const api: EngineWorkerApi = {
    init: (model, backend) => engine.init(model, { backend }),
    voices: () => engine.voices(),
    async synthesize(id, req) {
      const ac = new AbortController();
      running.set(id, ac);
      try {
        const r = await engine.synthesize(req, ac.signal);
        // Transfer the PCM instead of copying it.
        return Comlink.transfer(r, [r.pcm.buffer as ArrayBuffer]);
      } finally {
        running.delete(id);
      }
    },
    cancel(id) {
      running.get(id)?.abort();
    },
    dispose: () => engine.dispose(),
  };
  Comlink.expose(api, endpoint);
}

/** Host side: a RenderEngine that forwards to a worker. */
export class RemoteEngine implements RenderEngine {
  readonly kind = 'render' as const;
  private readonly api: Comlink.Remote<EngineWorkerApi>;
  private nextId = 1;

  constructor(
    readonly id: string,
    readonly caps: RenderEngine['caps'],
    endpoint: Comlink.Endpoint,
  ) {
    this.api = Comlink.wrap<EngineWorkerApi>(endpoint);
  }

  init(model: ModelManifest, opts: InitOptions) {
    return this.api.init(model, opts.backend);
  }

  voices() {
    return this.api.voices();
  }

  async synthesize(req: SynthesisRequest, signal?: AbortSignal): Promise<SynthesisResult> {
    if (signal?.aborted) throw new AbortError();
    const id = this.nextId++;
    const onAbort = () => void this.api.cancel(id);
    signal?.addEventListener('abort', onAbort, { once: true });
    try {
      const r = await this.api.synthesize(id, req);
      if (signal?.aborted) throw new AbortError();
      return r;
    } catch (e) {
      if (signal?.aborted) throw new AbortError();
      throw e;
    } finally {
      signal?.removeEventListener('abort', onAbort);
    }
  }

  dispose() {
    return this.api.dispose();
  }
}
