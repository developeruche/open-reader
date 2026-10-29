import { expect, test } from '../e2e/fixtures';
import { startModelServer } from './model-server';
import { existsSync } from 'node:fs';

const HIGH = 'piper-en_US-lessac-high';
test.skip(!existsSync('models/cache/piper/en_US-lessac-high.onnx'), 'run pnpm models:fetch all');

const call = <R>(page: import('@playwright/test').Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) =>
      (window as unknown as { __models: Record<string, (...x: unknown[]) => Promise<unknown>> })
        .__models[f as string]!(...(a as unknown[])) as Promise<R>,
    [fn, args] as const,
  ) as Promise<R>;

for (const backend of ['webgpu', 'wasm'] as const) {
  test(`@slow Piper Classic ${backend}: installs, verifies and synthesizes 22.05 kHz speech`, async ({
    context,
    extensionId,
  }) => {
    const server = await startModelServer(8769);
    try {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/options.html`);
      await page.waitForFunction(() => (window as { __models?: unknown }).__models !== undefined);
      await call(page, 'install', HIGH, backend, server.base);
      expect(await call<string[]>(page, 'verify', HIGH)).toEqual([]);
      const r = await call<{
        backend: string;
        sampleRate: number;
        duration: number;
        rmsDb: number;
        nan: boolean;
        words: unknown[];
        ms: number;
        rtf: number;
      }>(
        page,
        'synth',
        { engineId: 'piper', modelId: HIGH, backend },
        'en_US-lessac-high',
        'A P S B T lets several wallets cooperate before broadcasting.',
      );
      console.log(`piper ${backend}: synth ${r.ms} ms, RTF ${r.rtf.toFixed(3)}`);
      expect(r.backend).toBe(backend);
      expect(r.sampleRate).toBe(22050);
      expect(r.nan).toBe(false);
      expect(r.rmsDb).toBeGreaterThan(-40);
      expect(r.duration).toBeGreaterThan(2);
      expect(r.words).toEqual([]); // estimated by the player
    } finally {
      server.close();
    }
  });
}

test('@slow timing estimates stay within 120 ms of Kokoro native timings', async ({
  context,
  extensionId,
}) => {
  test.skip(!existsSync('models/cache/kokoro/onnx/model_quantized.onnx'), 'run pnpm models:fetch');
  const server = await startModelServer(8770);
  try {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/options.html`);
    await page.waitForFunction(() => (window as { __models?: unknown }).__models !== undefined);
    const backend = (await page.evaluate(
      async () =>
        !!(await (
          navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }
        ).gpu?.requestAdapter()),
    ))
      ? 'webgpu'
      : 'wasm';
    await call(page, 'install', 'kokoro-82m-v1-timestamped', backend, server.base);
    const { corpus } = await import('../../scripts/corpus');
    const r = await call<{ sentences: number; meanMs: number }>(
      page,
      'estimateError',
      { engineId: 'kokoro', modelId: 'kokoro-82m-v1-timestamped', backend },
      'af_heart',
      corpus(200),
    );
    console.log(`estimate error: ${r.meanMs.toFixed(0)} ms over ${r.sentences} sentences`);
    expect(r.sentences).toBeGreaterThan(150);
    expect(r.meanMs).toBeLessThanOrEqual(120);
  } finally {
    server.close();
  }
});
