/**
 * InPageHost (PLAN.md §4.2): the reader page owns its engine and playback, so Document mode never
 * hits the offscreen lifetime rules. It reports status to the background only for arbitration.
 */
import type { ReadingDocument } from '@/core/document/model';
import { openEngine, type EngineHandle } from '@/engines/factory';
import { RenderedBackend } from '@/engines/playback/rendered';
import { IdbSynthesisCache } from '@/platform/audioCache';
import { connectWithRetry } from '@/platform/ports';
import { HostRuntime } from './hostRuntime';
import {
  DEFAULT_SESSION_SETTINGS,
  PORT,
  type HostCommand,
  type HostEvent,
  type SessionSettings,
} from './protocol';

export interface InPageHost {
  runtime: HostRuntime;
  backend: RenderedBackend;
  load(
    doc: ReadingDocument,
    opts?: { start?: number; settings?: Partial<SessionSettings>; autoplay?: boolean },
  ): Promise<void>;
  sessionId: string;
}

export function createInPageHost(onEvent?: (e: HostEvent) => void): InPageHost {
  let handle: EngineHandle | undefined;
  const backend = new RenderedBackend();
  const sessionId = `inpage-${crypto.randomUUID()}`;
  const runtime: HostRuntime = new HostRuntime({
    kind: 'inpage',
    backend,
    cache: new IdbSynthesisCache(),
    async engineFor(settings) {
      if (
        !handle ||
        handle.engineId !== settings.engineId ||
        (settings.backend && handle.backend !== settings.backend)
      ) {
        handle?.terminate();
        handle = await openEngine(settings);
      }
      return handle;
    },
    resetEngine() {
      handle?.terminate();
      handle = undefined;
    },
    emit(e) {
      onEvent?.(e);
      // Only arbitration-relevant events go to the background.
      if (e.type === 'HELLO' || e.type === 'STATUS' || e.type === 'POSITION') port.post(e);
    },
  });
  const port = connectWithRetry<HostCommand, HostEvent>({
    name: PORT.inpageHost,
    onMessage: (cmd) => void runtime.handle(cmd),
    onConnect: () => runtime.hello(),
  });
  return {
    runtime,
    backend,
    sessionId,
    load: (doc, o = {}) =>
      runtime.handle({
        type: 'LOAD',
        sessionId,
        doc,
        start: { sentence: o.start ?? 0, word: 0 },
        settings: { ...DEFAULT_SESSION_SETTINGS, ...o.settings },
        autoplay: o.autoplay ?? false,
      }),
  };
}
