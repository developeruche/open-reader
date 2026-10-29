/** Creates engines inside dedicated workers (PLAN.md §5.3). Real engines are added from M6. */
import type { Endpoint } from 'comlink';
import type { RenderEngine } from '@/core/tts/engine';
import { RemoteEngine } from './rpc';
import { TestEngine } from './test/engine';

export interface EngineHandle {
  engineId: string;
  engine: RenderEngine;
  model: { modelId: string; version: string };
  terminate(): void;
}

export function createEngine(engineId: string): EngineHandle {
  switch (engineId) {
    case 'test':
    default: {
      const worker = new Worker(new URL('./test/worker.ts', import.meta.url), { type: 'module' });
      const engine = new RemoteEngine('test', new TestEngine().caps, worker as unknown as Endpoint);
      return {
        engineId: 'test',
        engine,
        model: { modelId: 'test-tone', version: '1' },
        terminate: () => worker.terminate(),
      };
    }
  }
}
