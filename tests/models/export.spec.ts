/**
 * Audiobook export with a real voice (M11): Kokoro speech at 24 kHz, chapters, and loudness checked
 * independently with FFmpeg's EBU R128 meter when FFmpeg is installed.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseBuffer } from 'music-metadata';
import { expect, test } from '../e2e/fixtures';
import {
  command,
  currentWorker,
  expectState,
  serveFixtures,
  session,
  tabIdOf,
} from '../e2e/runtime-helpers';
import { hasModels, startModelServer } from './model-server';

test.skip(!hasModels(), 'models/cache is empty: run pnpm models:fetch');

const FORMAT = (process.env.EXPORT_FORMAT ?? 'mp3') as 'mp3' | 'wav';

declare const chrome: { downloads: { search(q: object): Promise<{ filename: string }[]> } };

test('@slow exports a page read by Kokoro as an MP3 at −17 LUFS', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(240_000);
  const server = await startModelServer();
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.waitForFunction(() => (window as { __models?: unknown }).__models !== undefined);
  const backend = (await options.evaluate(
    async () =>
      !!(await (
        navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }
      ).gpu?.requestAdapter()),
  ))
    ? 'webgpu'
    : 'wasm';
  const call = (fn: string, ...a: unknown[]) =>
    options.evaluate(
      ([f, x]) =>
        (
          window as unknown as { __models: Record<string, (...y: unknown[]) => Promise<unknown>> }
        ).__models[f as string]?.(...(x as unknown[])),
      [fn, a] as const,
    );
  await call('install', 'kokoro-82m-v1-timestamped', backend, server.base);
  await call('setVoice', {
    engineId: 'kokoro',
    modelId: 'kokoro-82m-v1-timestamped',
    backend,
    voice: 'af_heart',
  });
  server.close();
  await serveFixtures(context);
  const page = await context.newPage();
  await page.goto('https://fixtures.test/blog.html');
  await command(context, {
    type: 'READ_TAB',
    tabId: await tabIdOf(context, 'https://fixtures.test/blog.html'),
  });
  await expectState(context, 'playing', 60_000);
  await command(context, { type: 'PAUSE' });
  const t0 = Date.now();
  await command(context, { type: 'EXPORT', format: FORMAT });
  await expect
    .poll(async () => (await session(context))?.exportJob?.state, { timeout: 180_000 })
    .toBe('done');
  const seconds = (Date.now() - t0) / 1000;
  const sw = await currentWorker(context);
  const [item] = await sw.evaluate(() => chrome.downloads.search({ state: 'complete' }));
  const file = item?.filename ?? '';
  const m = await parseBuffer(
    new Uint8Array(readFileSync(file)),
    { mimeType: FORMAT === 'mp3' ? 'audio/mpeg' : 'audio/wav' },
    { duration: true },
  );
  expect(m.format.sampleRate).toBe(24000);
  if (FORMAT === 'mp3') expect(m.format.bitrate).toBe(64000);
  // Three chapters: the page title, then one per h2 (WAV carries them in its `id3 ` chunk).
  expect(
    m.format.chapters ?? (m.native['ID3v2.3'] ?? []).filter((t) => t.id === 'CHAP'),
  ).toHaveLength(3);
  let ffmpeg = true;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
  } catch {
    ffmpeg = false;
  }
  let lufs = NaN;
  let tp = NaN;
  if (ffmpeg) {
    const log = execFileSync(
      'sh',
      ['-c', `ffmpeg -nostats -i "${file}" -af ebur128=peak=true -f null - 2>&1`],
      { encoding: 'utf8' },
    );
    const summary = log.slice(log.lastIndexOf('Summary:'));
    lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]);
    tp = Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1]);
    // EBU R128 tolerance: ±0.5 LU around the −17 LUFS target; true peak at most −1.5 dBTP.
    expect(lufs).toBeGreaterThanOrEqual(-17.5);
    expect(lufs).toBeLessThanOrEqual(-16.5);
    expect(tp).toBeLessThanOrEqual(-1.5);
  }
  console.log(
    `export kokoro ${backend} ${FORMAT}: ${m.format.duration?.toFixed(1)} s of audio in ${seconds.toFixed(1)} s, ffmpeg I ${lufs} LUFS, true peak ${tp} dBTP`,
  );
});
