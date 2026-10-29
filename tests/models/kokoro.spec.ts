import type { Page } from '@playwright/test';
import { expect, test } from '../e2e/fixtures';
import {
  command,
  debugLog,
  expectState,
  serveFixtures,
  session,
  tabIdOf,
} from '../e2e/runtime-helpers';
import { hasModels, startModelServer } from './model-server';

const KOKORO = 'kokoro-82m-v1-timestamped';
type Hooks = {
  install(id: string, backend: string, base: string): Promise<{ ms: number }>;
  verify(id: string): Promise<string[]>;
  synth(
    c: object,
    voice: string,
    text: string,
  ): Promise<{
    backend: string;
    sampleRate: number;
    duration: number;
    rmsDb: number;
    nan: boolean;
    words: { charStart: number; charEnd: number; start: number; end: number }[];
    initMs: number;
    ms: number;
    rtf: number;
  }>;
  setVoice(v: object): Promise<void>;
};

async function optionsPage(
  context: import('@playwright/test').BrowserContext,
  extensionId: string,
) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.waitForFunction(
    () => 'window' in globalThis && (window as { __models?: unknown }).__models !== undefined,
  );
  return page;
}

const call = <R>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) =>
      (window as unknown as { __models: Record<string, (...x: unknown[]) => Promise<unknown>> })
        .__models[f as string]!(...(a as unknown[])) as Promise<R>,
    [fn, args] as const,
  ) as Promise<R>;

test.skip(!hasModels(), 'models/cache is empty: run pnpm models:fetch');

for (const backend of ['webgpu', 'wasm'] as const) {
  test(`@slow Kokoro ${backend}: installs, verifies and synthesizes with sane timings`, async ({
    context,
    extensionId,
  }) => {
    const server = await startModelServer();
    try {
      const page = await optionsPage(context, extensionId);
      const { ms } = await call<{ ms: number }>(page, 'install', KOKORO, backend, server.base);
      expect(await call<string[]>(page, 'verify', KOKORO)).toEqual([]);
      const text = 'A P S B T lets several wallets cooperate before broadcasting.';
      const r = await call<Awaited<ReturnType<Hooks['synth']>>>(
        page,
        'synth',
        { engineId: 'kokoro', modelId: KOKORO, backend },
        'af_heart',
        text,
      );
      console.log(
        `kokoro ${backend}: install ${ms} ms, init ${r.initMs} ms, synth ${r.ms} ms, RTF ${r.rtf.toFixed(3)}`,
      );
      expect(r.backend).toBe(backend);
      expect(r.sampleRate).toBe(24000);
      expect(r.nan).toBe(false);
      expect(r.rmsDb).toBeGreaterThan(-40); // non-silent
      expect(r.duration).toBeGreaterThan(2);
      // Timings: one per word, monotonic, inside the audio, char ranges inside the text.
      expect(r.words.map((w) => text.slice(w.charStart, w.charEnd))).toEqual(text.split(' '));
      for (let i = 0; i < r.words.length; i++) {
        const w = r.words[i]!;
        expect(w.end).toBeGreaterThanOrEqual(w.start);
        expect(w.end).toBeLessThanOrEqual(r.duration + 0.05);
        if (i) expect(w.start).toBeGreaterThanOrEqual(r.words[i - 1]!.start);
      }
    } finally {
      server.close();
    }
  });
}

test('@slow offline: reads a page with Kokoro after the network is cut', async ({
  context,
  extensionId,
}) => {
  const server = await startModelServer();
  const page = await optionsPage(context, extensionId);
  const backend = (await page.evaluate(
    async () =>
      !!(await (
        navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }
      ).gpu?.requestAdapter()),
  ))
    ? 'webgpu'
    : 'wasm';
  await call(page, 'install', KOKORO, backend, server.base);
  await call(page, 'setVoice', { engineId: 'kokoro', modelId: KOKORO, backend, voice: 'af_heart' });
  server.close();
  // Load the article first (it is served by a route), then cut everything.
  await serveFixtures(context);
  const article = await context.newPage();
  await article.goto('https://fixtures.test/blog.html');
  const outbound: string[] = [];
  context.on('request', (r) => {
    if (!r.url().startsWith('chrome-extension://')) outbound.push(r.url());
  });
  await context.unrouteAll();
  await context.route('**/*', (route) => route.abort('internetdisconnected'));
  await context.setOffline(true);
  const tabId = await tabIdOf(context, 'https://fixtures.test/blog.html');
  await command(context, { type: 'READ_TAB', tabId });
  await expectState(context, 'playing', 60_000);
  await expect
    .poll(
      async () =>
        (await debugLog(context)).filter((e) => e.kind === 'sync' && e.type === 'SEGMENT_STARTED')
          .length,
      { timeout: 60_000 },
    )
    .toBeGreaterThanOrEqual(3);
  expect((await session(context))?.settings.engineId).toBe('kokoro');
  expect(outbound).toEqual([]);
});
