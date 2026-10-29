/** Creates engines inside dedicated workers (PLAN.md §5.3) and initializes them. */
import type { Endpoint } from 'comlink';
import type { RenderEngine } from '@/core/tts/engine';
import { RegistrySchema, type ModelManifest } from '@/core/tts/registry';
import { modelDir } from '@/core/models/manager';
import registryJson from '../../models/registry.json';
import { RemoteEngine } from './rpc';
import { SystemEngine } from './system/engine';
import type { TtsApi } from './system/tts';
import { TestEngine } from './test/engine';

export const REGISTRY = RegistrySchema.parse(registryJson);

export interface EngineHandle {
  engineId: string;
  modelId: string;
  engine: RenderEngine;
  model: { modelId: string; version: string };
  backend: string;
  terminate(): void;
}

export interface EngineChoice {
  engineId: string;
  modelId?: string;
  backend?: 'webgpu' | 'wasm';
}

export function manifestFor(
  modelId: string | undefined,
  engineId: string,
): ModelManifest | undefined {
  return (
    REGISTRY.models.find((m) => m.id === modelId) ??
    REGISTRY.models.find((m) => m.engine === engineId)
  );
}

const KOKORO_CAPS: RenderEngine['caps'] = {
  wordTimings: 'native',
  maxChars: 300,
  requiresNetwork: false,
  backends: ['webgpu', 'wasm'],
};
const PIPER_CAPS: RenderEngine['caps'] = {
  wordTimings: 'estimated',
  maxChars: 400,
  requiresNetwork: false,
  backends: ['webgpu', 'wasm'],
};

export async function openEngine(
  choice: EngineChoice,
  env: { tts?: TtsApi } = {},
): Promise<EngineHandle> {
  if (choice.engineId === 'system') {
    if (!env.tts) throw new Error('System voices are not available here');
    const engine = new SystemEngine(env.tts);
    return {
      engineId: 'system',
      modelId: 'system',
      engine,
      model: { modelId: 'system', version: '1' },
      backend: 'system',
      terminate: () => env.tts?.stop(),
    };
  }
  if (choice.engineId === 'kokoro') {
    const manifest = manifestFor(choice.modelId, 'kokoro');
    if (!manifest) throw new Error('Kokoro is not in the model registry');
    const worker = new Worker(new URL('./kokoro/worker.ts', import.meta.url), {
      type: 'module',
      name: modelDir(manifest),
    });
    const engine = new RemoteEngine('kokoro', KOKORO_CAPS, worker as unknown as Endpoint);
    try {
      const { backend } = await engine.init(manifest, { backend: choice.backend ?? 'auto' });
      return {
        engineId: 'kokoro',
        modelId: manifest.id,
        engine,
        model: { modelId: manifest.id, version: manifest.version },
        backend,
        terminate: () => worker.terminate(),
      };
    } catch (e) {
      worker.terminate();
      throw e;
    }
  }
  if (choice.engineId === 'piper') {
    const manifest = manifestFor(choice.modelId, 'piper');
    if (!manifest) throw new Error('Piper is not in the model registry');
    const worker = new Worker(new URL('./piper/worker.ts', import.meta.url), {
      type: 'module',
      name: modelDir(manifest),
    });
    const engine = new RemoteEngine('piper', PIPER_CAPS, worker as unknown as Endpoint);
    try {
      const { backend } = await engine.init(manifest, { backend: choice.backend ?? 'auto' });
      return {
        engineId: 'piper',
        modelId: manifest.id,
        engine,
        model: { modelId: manifest.id, version: manifest.version },
        backend,
        terminate: () => worker.terminate(),
      };
    } catch (e) {
      worker.terminate();
      throw e;
    }
  }
  if (choice.engineId !== 'test')
    throw new Error(`The ${choice.engineId} engine is not available yet.`);
  const worker = new Worker(new URL('./test/worker.ts', import.meta.url), { type: 'module' });
  const engine = new RemoteEngine('test', new TestEngine().caps, worker as unknown as Endpoint);
  return {
    engineId: 'test',
    modelId: 'test-tone',
    engine,
    model: { modelId: 'test-tone', version: '1' },
    backend: 'wasm',
    terminate: () => worker.terminate(),
  };
}
