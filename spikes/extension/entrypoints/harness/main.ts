// Spike harness page: Playwright calls window.spike.* and reads JSON results.
const send = <T = unknown>(msg: Record<string, unknown>) => chrome.runtime.sendMessage(msg) as Promise<T>;

async function opfs(url: string) {
  const persisted = await navigator.storage.persist();
  const before = await navigator.storage.estimate();
  const root = await navigator.storage.getDirectory();
  const dir = await root.getDirectoryHandle('models', { create: true });
  const fh = await dir.getFileHandle('spike.onnx', { create: true });
  const t0 = performance.now();
  const res = await fetch(url);
  const writable = await fh.createWritable();
  await res.body!.pipeTo(writable); // streamed: never holds the whole file in memory
  const tWrite = performance.now();
  const file = await fh.getFile();
  const buf = await file.arrayBuffer();
  const tRead = performance.now();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  const tHash = performance.now();
  const after = await navigator.storage.estimate();
  await dir.removeEntry('spike.onnx');
  const mb = buf.byteLength / 1e6;
  return {
    persisted, bytes: buf.byteLength,
    writeMs: Math.round(tWrite - t0), readMs: Math.round(tRead - tWrite), sha256Ms: Math.round(tHash - tRead),
    writeMBps: +(mb / ((tWrite - t0) / 1000)).toFixed(0), readMBps: +(mb / ((tRead - tWrite) / 1000)).toFixed(0),
    sha256: [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''),
    quotaGB: +((before.quota ?? 0) / 1e9).toFixed(1), usageBeforeMB: +((before.usage ?? 0) / 1e6).toFixed(1), usageDuringMB: +((after.usage ?? 0) / 1e6).toFixed(1),
  };
}

async function highlight(tabId: number) {
  await chrome.scripting.executeScript({ target: { tabId }, files: ['content-scripts/highlight.js'] });
  const [r] = await chrome.scripting.executeScript({ target: { tabId }, func: () => (globalThis as Record<string, unknown>).__spike });
  return r?.result;
}

Object.assign(window, {
  spike: {
    send,
    offscreen: (msg: Record<string, unknown>) => send({ target: 'offscreen', ...msg }),
    opfs,
    highlight,
    tabs: () => chrome.tabs.query({}),
  },
});
document.getElementById('out')!.textContent = 'harness ready';
