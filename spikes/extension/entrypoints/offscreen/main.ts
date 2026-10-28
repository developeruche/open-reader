import { analyseRates } from '../../lib/audio-probe';

// Long-lived port so the background can detect the document going away.
chrome.runtime.connect({ name: 'offscreen' });

let current: HTMLAudioElement | null = null;

function runWorker(w: Worker, msg: unknown): Promise<unknown> {
  return new Promise((resolve) => {
    w.onmessage = (ev) => {
      if (ev.data?.type === 'log') return console.log(ev.data.msg);
      resolve(ev.data);
      w.terminate();
    };
    w.onerror = (ev) => resolve({ error: ev.message || 'worker error' });
    w.postMessage(msg);
  });
}

chrome.runtime.onMessage.addListener((msg, _s, reply) => {
  if (msg.target !== 'offscreen') return;
  (async () => {
    switch (msg.type) {
      case 'probe':
        return {
          gpu: !!(navigator as Navigator & { gpu?: unknown }).gpu,
          hidden: document.visibilityState,
          sab: typeof SharedArrayBuffer,
          isolated: self.crossOriginIsolated,
          cores: navigator.hardwareConcurrency,
          apis: Object.keys(chrome).sort(),
        };
      case 'kokoro':
        return runWorker(new Worker(new URL('../../lib/kokoro.worker.ts', import.meta.url), { type: 'module' }), msg);
      case 'piper':
        return runWorker(new Worker(new URL('../../lib/piper.worker.ts', import.meta.url), { type: 'module' }), msg);
      case 'rates':
        return analyseRates(msg.rates);
      case 'play-short': {
        current = new Audio(msg.url);
        await current.play();
        await new Promise((r) => setTimeout(r, 500));
        current.pause();
        return { paused: true, t: current.currentTime };
      }
      case 'ping':
        return { pong: true, at: Date.now() };
      default:
        return undefined;
    }
  })().then(reply, (e: unknown) => reply({ error: String(e) }));
  return true;
});
