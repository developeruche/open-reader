/* eslint-disable */
// M1 spike driver. Serves models/cache on localhost, loads the spike extension, runs every probe.
import { chromium } from '@playwright/test';
import { createReadStream, existsSync, mkdirSync, mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { PDFDocument, StandardFonts } from 'pdf-lib';

const ROOT = path.resolve('.');
const OUT = path.join(ROOT, 'spikes/out');
const EXT = path.join(ROOT, 'spikes/extension/.output/chrome-mv3');
const PORT = 8765;
const only = process.argv.slice(2);
const want = (k: string) => only.length === 0 || only.includes(k);
mkdirSync(OUT, { recursive: true });

function wav(pcm: number[], sr: number): Buffer {
  const b = Buffer.alloc(44 + pcm.length * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + pcm.length * 2, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22); b.writeUInt32LE(sr, 24);
  b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(pcm.length * 2, 40);
  pcm.forEach((v, i) => b.writeInt16LE(Math.max(-32768, Math.min(32767, Math.round(v * 32767))), 44 + i * 2));
  return b;
}

async function makePdf(): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const words = 'the quick reader follows each word across the page while the voice continues reading aloud'.split(' ');
  for (let p = 1; p <= 4; p++) {
    const page = doc.addPage([612, 792]);
    page.drawText(`Spike Journal of Reading Order`, { x: 72, y: 750, size: 9, font });
    for (let col = 0; col < 2; col++) {
      for (let line = 0; line < 40; line++) {
        let text = Array.from({ length: 6 }, (_, k) => words[(p * 7 + col * 13 + line * 3 + k) % words.length]).join(' ');
        if (p === 3 && col === 1 && line === 10) text = 'only here a zebra appears';
        page.drawText(text, { x: 72 + col * 252, y: 700 - line * 15, size: 10, font });
      }
    }
    page.drawText(`${p}`, { x: 300, y: 40, size: 9, font });
  }
  writeFileSync(path.join(OUT, 'two-column.pdf'), await doc.save());
}

const server = createServer((req, res) => {
  const url = decodeURIComponent((req.url ?? '/').split('?')[0]!);
  const file = url.startsWith('/models/') ? path.join(ROOT, 'models/cache', url.slice(8)) : path.join(OUT, url);
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!existsSync(file) || statSync(file).isDirectory()) { res.statusCode = 404; return res.end(); }
  res.setHeader('Content-Length', statSync(file).size);
  createReadStream(file).pipe(res);
});

const SENTENCES = [
  'Open Reader reads web pages and documents aloud.',
  'A partially signed Bitcoin transaction lets several wallets cooperate before broadcasting.',
  'The cursor follows the voice, word by word, across every page.',
  'Dr. Smith measured a latency of 42 milliseconds in version 3.2.',
  'When the model runs on the GPU, the first audio arrives quickly.',
];

async function main() {
  await makePdf();
  writeFileSync(path.join(OUT, 'tone.wav'), wav(Array.from({ length: 24000 * 3 }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 440 * i) / 24000)), 24000));
  await new Promise<void>((r) => server.listen(PORT, r));
  const userDir = mkdtempSync(path.join(tmpdir(), 'or-spike-'));
  const ctx = await chromium.launchPersistentContext(userDir, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--autoplay-policy=no-user-gesture-required'],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const id = sw.url().split('/')[2];
  const h = await ctx.newPage();
  h.on('console', (m) => console.log('[harness]', m.text()));
  await h.goto(`chrome-extension://${id}/harness.html`);
  await h.waitForFunction(() => document.getElementById('out')?.textContent === 'harness ready');
  const call = (fn: string, ...args: unknown[]) => h.evaluate(([f, a]) => {
    const parts = (f as string).split('.');
    let o: any = (window as any).spike;
    for (const p of parts.slice(0, -1)) o = o[p];
    return o[parts.at(-1)!](...(a as unknown[]));
  }, [fn, args] as const);
  const results: Record<string, unknown> = { at: new Date().toISOString(), chromium: ctx.browser()?.version() ?? 'persistent' };
  const save = () => writeFileSync(path.join(OUT, 'results.json'), JSON.stringify(results, (k, v) => (k === 'pcm' ? undefined : v), 2));

  await call('send', { type: 'ensure-offscreen' });
  results.offscreenProbe = await call('offscreen', { type: 'probe' });
  console.log('probe', results.offscreenProbe);

  if (want('kokoro')) {
    const k: unknown[] = [];
    for (const [backend, variant, threads] of [['webgpu', 'model.onnx', 1], ['webgpu', 'model_fp16.onnx', 1], ['wasm', 'model_quantized.onnx', 1], ['wasm', 'model_quantized.onnx', 4], ['wasm', 'model_quantized.onnx', 8]] as const) {
      const r: any = await call('offscreen', { type: 'kokoro', backend, variant, threads, modelBase: `http://localhost:${PORT}/models/kokoro`, voice: 'af_heart', sentences: SENTENCES });
      console.log('kokoro', backend, variant, threads, r.error ?? `rtf ${r.rtf} init ${r.initMs}ms first ${r.firstAudioMs}ms`);
      const pcm = r.results?.[0]?.pcm;
      if (pcm) writeFileSync(path.join(OUT, `kokoro-${backend}-${variant}-${threads}.wav`), wav(pcm, 24000));
      k.push(r);
      results.kokoro = k; save();
    }
  }
  if (want('piper')) {
    const p: unknown[] = [];
    const runs: [string, string, number][] = [['en_US-lessac-high', 'wasm', 1], ['en_US-lessac-medium', 'wasm', 1], ['en_US-lessac-high', 'webgpu', 1], ['en_US-lessac-high', 'wasm', 4], ['en_US-lessac-medium', 'wasm', 4]];
    for (const [voice, backend, threads] of runs) {
      const r: any = await call('offscreen', { type: 'piper', voice, backend, threads, voiceBase: `http://localhost:${PORT}/models/piper`, sentences: SENTENCES, lengthScale: 1.1 });
      console.log('piper', voice, backend, threads, 'isolated', r.isolated, r.error ? r.error.slice(0, 300) : `rtf ${r.rtf} init ${r.initMs}ms first ${r.firstAudioMs}ms`);
      const pcm = r.results?.[0]?.pcm;
      if (pcm) writeFileSync(path.join(OUT, `piper-${voice}-${backend}-${threads}.wav`), wav(pcm, r.results[0].sampleRate));
      p.push(r);
      results.piper = p; save();
    }
  }
  if (want('audio')) {
    results.rates = await call('offscreen', { type: 'rates', rates: [0.75, 1, 1.5, 2.5, 3.5] });
    console.log('rates', results.rates);
    // 30-second rule: for each reason set, play briefly, pause, then watch for the document to close.
    const lifetimes: unknown[] = [];
    for (const reasons of [['AUDIO_PLAYBACK'], ['AUDIO_PLAYBACK', 'WORKERS']]) {
      await call('send', { type: 'close-offscreen' });
      await call('send', { type: 'ensure-offscreen', reasons });
      await call('offscreen', { type: 'play-short', url: `http://localhost:${PORT}/tone.wav` }).catch((e) => console.log('play-short', e));
      const pausedAt = Date.now();
      const timeline: { s: number; present: boolean }[] = [];
      for (let i = 0; i <= 12; i++) {
        const { present } = (await call('send', { type: 'has-offscreen' })) as { present: boolean };
        timeline.push({ s: Math.round((Date.now() - pausedAt) / 1000), present });
        if (!present) break;
        await h.waitForTimeout(5000);
      }
      const t1 = Date.now();
      await call('send', { type: 'ensure-offscreen', reasons });
      const pong = await call('offscreen', { type: 'ping' });
      const lt = { reasons, timeline, recreateMs: Date.now() - t1, pong };
      console.log('lifetime', JSON.stringify(lt));
      lifetimes.push(lt);
    }
    results.offscreenLifetime = { runs: lifetimes, events: ((await call('send', { type: 'events' })) as any).events };
    save();
  }
  if (want('opfs')) {
    results.opfs = await call('opfs', `http://localhost:${PORT}/models/kokoro/onnx/model.onnx`);
    console.log('opfs', results.opfs); save();
  }
  if (want('highlight')) {
    const sites = ['https://en.wikipedia.org/wiki/Bitcoin', 'https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API', 'https://paulgraham.com/greatwork.html'];
    const hs: unknown[] = [];
    for (const url of sites) {
      const pg = await ctx.newPage();
      try {
        await pg.goto(url, { waitUntil: 'load', timeout: 45000 });
        const tabs: any[] = await call('tabs');
        const tab = tabs.find((t) => t.url?.startsWith(url.split('#')[0]!));
        const r = await call('highlight', tab.id);
        await pg.waitForTimeout(300);
        await pg.screenshot({ path: path.join(OUT, `highlight-${new URL(url).hostname}.png`) });
        hs.push({ url, ...(r as object) });
        console.log('highlight', url, JSON.stringify(r));
      } catch (e) { hs.push({ url, error: String(e) }); console.log('highlight error', url, e); }
      await pg.close();
    }
    results.highlight = hs; save();
  }
  if (want('pdf')) {
    const pg = await ctx.newPage();
    await pg.setViewportSize({ width: 1000, height: 900 });
    await pg.goto(`chrome-extension://${id}/pdf.html`);
    await pg.waitForFunction(() => document.title === 'pdf ready');
    results.pdf = await pg.evaluate(([u]) => (window as any).spikePdf(u, 3, 'zebra'), [`http://localhost:${PORT}/two-column.pdf`]);
    await pg.waitForTimeout(300);
    await pg.screenshot({ path: path.join(OUT, 'pdf-page3.png') });
    console.log('pdf', results.pdf); save();
  }
  save();
  await ctx.close();
  server.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
