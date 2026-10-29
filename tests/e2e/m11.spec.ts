import { readFileSync } from 'node:fs';
import type { BrowserContext, Page } from '@playwright/test';
import { parseBuffer } from 'music-metadata';
import { expect, test } from './fixtures';
import { command, currentWorker, expectState, readFixture, session } from './runtime-helpers';

declare const chrome: {
  downloads: {
    search(
      q: object,
    ): Promise<{ filename: string; state: string; mime: string; fileSize: number }[]>;
  };
};

async function sidePanel(context: BrowserContext, extensionId: string): Promise<Page> {
  const tabId = (await session(context))?.tabId;
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
  await page.getByRole('tab', { name: 'Settings' }).click();
  return page;
}

test('exports the page as an MP3 audiobook with a chapter per heading', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(90_000);
  await readFixture(context);
  await command(context, { type: 'PAUSE' });
  const panel = await sidePanel(context, extensionId);
  await panel.getByRole('button', { name: 'Export audiobook…' }).click();
  await panel.getByRole('button', { name: 'Start export' }).click();
  await expect(panel.getByText(/Saved “.+\.mp3” to Downloads\./).first()).toBeVisible({
    timeout: 60_000,
  });

  const sw = await currentWorker(context);
  const items = await sw.evaluate(() => chrome.downloads.search({ state: 'complete' }));
  expect(items).toHaveLength(1);
  const item = items[0];
  // Playwright stores downloads under generated names; the panel showed the real one.
  const bytes = new Uint8Array(readFileSync(item?.filename ?? ''));
  const m = await parseBuffer(bytes, { mimeType: 'audio/mpeg' }, { duration: true });
  expect(m.common.title).toBe((await session(context))?.title);
  const chapters = (m.native['ID3v2.3'] ?? []).filter((t) => t.id === 'CHAP');
  // The h1 starts the first chapter, then one per h2.
  expect(chapters.length).toBe(3);
  expect(m.format.duration ?? 0).toBeGreaterThan(10);
  // The export ran in the offscreen host without disturbing the paused session.
  expect((await session(context))?.state).toBe('paused');
});

test('the sleep timer pauses reading at a sentence boundary', async ({ context, extensionId }) => {
  await readFixture(context);
  const panel = await sidePanel(context, extensionId);
  await expect(panel.getByRole('combobox', { name: 'Sleep timer' })).toBeVisible();
  // 3 seconds, set through the command the select sends (the select's shortest choice is 5 min).
  await command(context, { type: 'SET_SLEEP', sleep: { kind: 'minutes', minutes: 0.05 } });
  await expect.poll(async () => (await session(context))?.sleep?.kind).toBe('minutes');
  await expectState(context, 'paused', 20_000);
  expect((await session(context))?.sleep).toBeNull();
  await expect(panel.getByRole('combobox', { name: 'Sleep timer' })).toHaveText(/Off/);
});

test('rules for one page re-read it and are remembered', async ({ context, extensionId }) => {
  await readFixture(context, 'docs.html');
  const sw = await currentWorker(context);
  const codeSkipped = () =>
    sw.evaluate(async () => {
      const g = globalThis as unknown as {
        __openReader: {
          orch: { currentDoc(): Promise<{ blocks: { type: string; skip?: string }[] }> };
        };
      };
      const d = await g.__openReader.orch.currentDoc();
      return d.blocks.filter((b) => b.type === 'code').every((b) => b.skip === 'code');
    });
  expect(await codeSkipped()).toBe(true);
  const panel = await sidePanel(context, extensionId);
  await panel.getByRole('switch', { name: 'Skip code blocks' }).click();
  await expect.poll(async () => (await session(context))?.docRules?.codeBlocks).toBe('read');
  expect(await codeSkipped()).toBe(false);
  await expect(panel.getByRole('button', { name: 'Use my default rules' })).toBeVisible();
  await panel.getByRole('button', { name: 'Use my default rules' }).click();
  await expect.poll(async () => (await session(context))?.docRules ?? null).toBeNull();
});

test('exports a PDF from the reader', async ({ context, extensionId }) => {
  test.setTimeout(90_000);
  const { FIXTURE_ORIGIN, serveFixtures } = await import('./runtime-helpers');
  await serveFixtures(context);
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/reader.html?src=${encodeURIComponent(`${FIXTURE_ORIGIN}/pdf/headers-footers.pdf`)}`,
  );
  await page.waitForFunction(
    () => (window as { __reader?: { state: { phase: string } } }).__reader?.state.phase === 'ready',
  );
  await page.getByRole('button', { name: 'Show reading rules' }).click();
  await page.getByRole('button', { name: 'Export audiobook…' }).click();
  await page.getByRole('combobox', { name: 'Format' }).click();
  await page.getByRole('option', { name: /WAV/ }).click();
  await page.getByRole('button', { name: 'Start export' }).click();
  await expect(page.getByText(/Saved “.+\.wav” to Downloads\./).first()).toBeVisible({
    timeout: 60_000,
  });
  const sw = await currentWorker(context);
  const items = await sw.evaluate(() => chrome.downloads.search({ state: 'complete' }));
  const bytes = new Uint8Array(readFileSync(items[0]?.filename ?? ''));
  expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF');
});
