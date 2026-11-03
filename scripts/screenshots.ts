/**
 * Screenshots for the README and the Chrome Web Store listing (1280×800), taken with the real
 * Kokoro voice:
 *   pnpm build:test && pnpm models:fetch kokoro && pnpm screenshots
 * Writes docs/images/{web,pdf}.png.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { hasModels, startModelServer } from '../tests/models/model-server';

const KOKORO = 'kokoro-82m-v1-timestamped';
const ARTICLE = 'https://screenshots.test/article.html';
const PDF = 'https://screenshots.test/paper.pdf';
const OUT = path.resolve('docs/images');
const W = 1280;
const H = 800;
const PANEL = 400;

interface Debug {
  orch: { session: { state: string; tabId?: number; cursor: { sentence: number } } | null };
  command(c: unknown): Promise<void>;
}
declare const __openReader: Debug;
declare const chrome: { tabs: { query(q: object): Promise<{ id?: number; url?: string }[]> } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => undefined as T);
    if (v !== undefined && ok(v)) return v;
    if (Date.now() > end) throw new Error('timed out');
    await sleep(250);
  }
}

async function worker(ctx: BrowserContext): Promise<Worker> {
  return (
    ctx.serviceWorkers().find((w) => w.url().endsWith('/background.js')) ??
    (await ctx.waitForEvent('serviceworker'))
  );
}

async function installKokoro(ctx: BrowserContext, extensionId: string): Promise<void> {
  const server = await startModelServer(8768);
  const options = await ctx.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await options.waitForFunction(() => (window as { __models?: unknown }).__models !== undefined);
  const call = (fn: string, ...a: unknown[]) =>
    options.evaluate(
      ([f, x]) =>
        (
          window as unknown as { __models: Record<string, (...y: unknown[]) => Promise<unknown>> }
        ).__models[f as string]?.(...(x as unknown[])),
      [fn, a] as const,
    );
  const gpu = await options.evaluate(
    async () =>
      !!(await (
        navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }
      ).gpu?.requestAdapter()),
  );
  const backend = gpu ? 'webgpu' : 'wasm';
  console.log(`installing Kokoro (${backend})…`);
  await call('install', KOKORO, backend, server.base);
  await call('setVoice', { engineId: 'kokoro', modelId: KOKORO, backend, voice: 'af_heart' });
  server.close();
  await options.close();
}

/** Puts two screenshots side by side: the page on the left, the side panel on the right. */
async function compose(ctx: BrowserContext, left: Buffer, right: Buffer): Promise<Buffer> {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: W, height: H });
  const img = (b: Buffer, w: number) =>
    `<img src="data:image/png;base64,${b.toString('base64')}" width="${w}" height="${H}">`;
  await page.setContent(
    `<body style="margin:0;display:flex;background:#fff">${img(left, W - PANEL)}` +
      `<div style="width:1px;background:#d9d6cf"></div>${img(right, PANEL - 1)}</body>`,
  );
  const shot = await page.screenshot();
  await page.close();
  return shot;
}

async function shoot(page: Page, width: number): Promise<Buffer> {
  await page.setViewportSize({ width, height: H });
  await page.evaluate(() => document.fonts.ready);
  return page.screenshot();
}

async function webShot(ctx: BrowserContext, extensionId: string): Promise<void> {
  const article = await ctx.newPage();
  await article.setViewportSize({ width: W - PANEL, height: H });
  await article.goto(ARTICLE);
  const sw = await worker(ctx);
  const tabId = await sw.evaluate(
    async (u) => (await chrome.tabs.query({})).find((t) => t.url === u)?.id,
    ARTICLE,
  );
  await sw.evaluate((id) => __openReader.command({ type: 'READ_TAB', tabId: id }), tabId);
  // Let it read into the second paragraph, then pause so the highlight holds still.
  await until(
    () => sw.evaluate(() => __openReader.orch.session?.cursor.sentence ?? -1),
    (s) => s >= 5,
    120_000,
  );
  await sleep(1200);
  await sw.evaluate(() => __openReader.command({ type: 'PAUSE' }));
  await until(
    () => sw.evaluate(() => __openReader.orch.session?.state),
    (s) => s === 'paused',
  );
  const panel = await ctx.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
  await panel.getByRole('button', { name: 'Play', exact: true }).waitFor();
  await sleep(500);
  const right = await shoot(panel, PANEL - 1);
  await article.bringToFront();
  await sleep(300);
  const left = await shoot(article, W - PANEL);
  writeFileSync(path.join(OUT, 'web.png'), await compose(ctx, left, right));
  await sw.evaluate(() => __openReader.command({ type: 'STOP' }));
  await panel.close();
  await article.close();
}

async function pdfShot(ctx: BrowserContext, extensionId: string): Promise<void> {
  const page = await ctx.newPage();
  await page.setViewportSize({ width: W, height: H });
  await page.goto(`chrome-extension://${extensionId}/reader.html?src=${encodeURIComponent(PDF)}`);
  await page.waitForFunction(
    () => (window as { __reader?: { state: { phase: string } } }).__reader?.state.phase === 'ready',
    undefined,
    { timeout: 60_000 },
  );
  await page.getByRole('button', { name: 'Play', exact: true }).first().click();
  await page.getByRole('button', { name: 'Pause', exact: true }).first().waitFor();
  await sleep(9000);
  await page.getByRole('button', { name: 'Pause', exact: true }).first().click();
  await sleep(600);
  writeFileSync(path.join(OUT, 'pdf.png'), await page.screenshot());
  await page.close();
}

async function main() {
  if (!hasModels()) throw new Error('models/cache is empty: run pnpm models:fetch kokoro');
  mkdirSync(OUT, { recursive: true });
  const ext = path.resolve('output/chrome-mv3-test');
  const profile = mkdtempSync(path.join(tmpdir(), 'or-shots-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    colorScheme: 'light',
    deviceScaleFactor: 1,
    args: [
      `--disable-extensions-except=${ext}`,
      `--load-extension=${ext}`,
      '--autoplay-policy=no-user-gesture-required',
    ],
  });
  try {
    await ctx.route('https://screenshots.test/**', (route) => {
      const pdf = route.request().url().endsWith('.pdf');
      route.fulfill({
        status: 200,
        contentType: pdf ? 'application/pdf' : 'text/html',
        headers: { 'Access-Control-Allow-Origin': '*' },
        body: readFileSync(
          pdf
            ? path.resolve('tests/fixtures/pdf/two-column.pdf')
            : path.resolve('scripts/screenshots/article.html'),
        ),
      });
    });
    const sw = await worker(ctx);
    const extensionId = sw.url().split('/')[2] ?? '';
    await installKokoro(ctx, extensionId);
    await webShot(ctx, extensionId);
    await pdfShot(ctx, extensionId);
    console.log(`wrote ${OUT}/web.png and pdf.png`);
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
  }
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
