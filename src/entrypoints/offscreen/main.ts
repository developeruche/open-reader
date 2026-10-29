// Engine host for Web mode (PLAN.md §4.2). Only chrome.runtime is available here.
import { openEngine, type EngineHandle } from '@/engines/factory';
import { RenderedBackend } from '@/engines/playback/rendered';
import { IdbSynthesisCache } from '@/platform/audioCache';
import { connectWithRetry } from '@/platform/ports';
import { HostRuntime } from '@/runtime/hostRuntime';
import { PORT, type HostCommand, type HostEvent } from '@/runtime/protocol';

let handle: EngineHandle | undefined;
const backend = new RenderedBackend();

const runtime: HostRuntime = new HostRuntime({
  kind: 'offscreen',
  backend,
  cache: new IdbSynthesisCache(),
  async engineFor(settings) {
    const wanted = settings.modelId ?? settings.engineId;
    if (
      !handle ||
      handle.engineId !== settings.engineId ||
      (settings.modelId && handle.modelId !== wanted) ||
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
  emit: (e) => port.post(e),
});

const port = connectWithRetry<HostCommand, HostEvent>({
  name: PORT.engineHost,
  onMessage: (cmd) => void runtime.handle(cmd),
  onConnect: () => runtime.hello(),
});

// Report how many decks are audible whenever playback state changes (diagnostics, tests).
setInterval(() => {
  const st = runtime.status();
  if (st && st.audible !== (backend.audibleCount() > 0 ? 1 : 0)) runtime.hello();
}, 1000);
