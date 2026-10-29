import { buildBlock } from '@/core/document/build';
import { createInPageHost } from '@/runtime/inpageHost';
import { mount } from '@/ui/mount';
import { ReaderApp } from '@/ui/shells/ReaderApp';

mount(() => <ReaderApp />);

// Test builds: `reader.html?inpageTest=1` starts an in-page engine host with a fixture document so
// E2E tests can check arbitration between hosts. Document mode wires the real UI in M9.
if (import.meta.env.MODE === 'test' && new URLSearchParams(location.search).has('inpageTest')) {
  const host = createInPageHost();
  const text =
    'The reader page owns its engine. It never hits the offscreen lifetime limit. Only one session is audible at a time.';
  void host.load(
    {
      id: 'inpage-fixture',
      kind: 'pdf',
      title: 'Fixture',
      lang: 'en',
      blocks: [buildBlock({ id: 'p', type: 'paragraph', text: text.repeat(4) })],
    },
    { autoplay: false },
  );
  Object.assign(window, {
    __inpage: {
      host,
      play: () => host.runtime.player?.send({ type: 'PLAY' }),
      pause: () => host.runtime.player?.send({ type: 'PAUSE' }),
      state: () => host.runtime.player?.state,
      audible: () => host.backend.audibleCount(),
    },
  });
}
