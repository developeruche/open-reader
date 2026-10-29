// Engine host for Web mode (PLAN.md §4.2). Only chrome.runtime is available here.
import { createEngine, type EngineHandle } from '@/engines/factory';
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
    if (!handle || handle.engineId !== settings.engineId) {
      handle?.terminate();
      handle = createEngine(settings.engineId);
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
