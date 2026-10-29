import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  closeOffscreen,
  command,
  debugLog,
  expectState,
  keyboard,
  offscreenExists,
  readFixture,
  sentence,
  session,
} from './runtime-helpers';

test.describe('extension runtime (TestEngine)', () => {
  test('reads a page: play, pause and resume at the same sentence', async ({ context }) => {
    await readFixture(context);
    const s = await session(context);
    expect(s?.title).toBe('How a PSBT moves between wallets');
    expect(s?.sentenceCount).toBe(16);
    await expect.poll(() => sentence(context), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    await command(context, { type: 'PAUSE' });
    await expectState(context, 'paused');
    const at = await sentence(context);
    await new Promise((r) => setTimeout(r, 1500));
    expect(await sentence(context)).toBe(at);
    await command(context, { type: 'PLAY' });
    await expectState(context, 'playing');
    expect(await sentence(context)).toBe(at);
    // The highlight sync stream reaches the background in order.
    const started = (await debugLog(context)).filter(
      (e) => e.kind === 'sync' && e.type === 'SEGMENT_STARTED',
    );
    expect(started.length).toBeGreaterThan(1);
  });

  test('never plays two segments at once in the offscreen host', async ({ context }) => {
    await readFixture(context);
    await expect.poll(() => sentence(context), { timeout: 20_000 }).toBeGreaterThanOrEqual(3);
    const statuses = (await debugLog(context)).filter((e) => e.kind === 'status');
    expect(statuses.length).toBeGreaterThan(0);
    for (const e of statuses)
      if (e.kind === 'status') expect(e.status.audible).toBeLessThanOrEqual(1);
  });

  test('recovers after the offscreen document is closed', async ({ context }) => {
    await readFixture(context);
    await expect.poll(() => sentence(context), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    await command(context, { type: 'PAUSE' });
    await expectState(context, 'paused');
    const at = await sentence(context);
    await closeOffscreen(context);
    await expect.poll(() => offscreenExists(context)).toBe(false);
    await expect.poll(async () => (await session(context))?.hostLost).toBe(true);
    const t0 = Date.now();
    await command(context, { type: 'PLAY' });
    await expectState(context, 'playing', 5000);
    expect(Date.now() - t0).toBeLessThan(3000); // §9.1: resume within 3 s
    expect(await offscreenExists(context)).toBe(true);
    expect(await sentence(context)).toBe(at);
  });

  test('a 35 second pause resumes at the same sentence', async ({ context }) => {
    test.setTimeout(90_000);
    await readFixture(context);
    await expect.poll(() => sentence(context), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    await command(context, { type: 'PAUSE' });
    await expectState(context, 'paused');
    const at = await sentence(context);
    await new Promise((r) => setTimeout(r, 35_000));
    await command(context, { type: 'PLAY' });
    await expectState(context, 'playing', 5000);
    expect(await sentence(context)).toBe(at);
  });

  test('survives a service worker restart', async ({ context, serviceWorker }) => {
    test.setTimeout(60_000);
    const page = await readFixture(context);
    await expect.poll(() => sentence(context), { timeout: 15_000 }).toBeGreaterThanOrEqual(1);
    await serviceWorker.evaluate(() => Object.assign(globalThis, { __marker: 1 }));
    const cdp = await context.newCDPSession(page);
    const { targetInfos } = await cdp.send('Target.getTargets');
    const target = targetInfos.find(
      (t) => t.type === 'service_worker' && t.url.endsWith('/background.js'),
    );
    expect(target).toBeDefined();
    await cdp.send('Target.closeTarget', { targetId: target!.targetId });
    // The offscreen host keeps playing; its port reconnects with backoff and wakes a new worker,
    // which restores the session from storage.session.
    const alive = () =>
      Promise.race([
        serviceWorker
          .evaluate(() => (globalThis as { __marker?: number }).__marker ?? 'fresh')
          .catch(() => 'down'),
        new Promise<string>((r) => setTimeout(() => r('down'), 1000)),
      ]);
    await expect.poll(alive, { timeout: 20_000, intervals: [500] }).toBe('fresh');
    await expect
      .poll(async () => (await session(context))?.state, { timeout: 15_000 })
      .toMatch(/playing|buffering/);
    const before = await sentence(context);
    await command(context, { type: 'PAUSE' });
    await expectState(context, 'paused');
    expect(await sentence(context)).toBeGreaterThanOrEqual(before);
  });

  test('keyboard commands toggle and skip', async ({ context }) => {
    await readFixture(context);
    await keyboard(context, 'toggle-play');
    await expectState(context, 'paused');
    const at = await sentence(context);
    await keyboard(context, 'next-sentence');
    await expect.poll(() => sentence(context)).toBe(at + 1);
    await keyboard(context, 'prev-sentence');
    await expect.poll(() => sentence(context)).toBe(at);
    await keyboard(context, 'toggle-play');
    await expectState(context, 'playing');
  });

  test('changes speed while playing', async ({ context }) => {
    await readFixture(context);
    await command(context, { type: 'SET_SPEED', rate: 2.5 });
    await expect.poll(async () => (await session(context))?.settings.rate).toBe(2.5);
    await expectState(context, 'playing');
  });

  test('reads a selection', async ({ context }) => {
    const page = await readFixture(context);
    await command(context, { type: 'STOP' });
    await page.evaluate(() => {
      const li = document.querySelectorAll('li')[2]!;
      const r = document.createRange();
      r.selectNodeContents(li);
      getSelection()!.removeAllRanges();
      getSelection()!.addRange(r);
    });
    const tabId = (await session(context))!.tabId!;
    await command(context, { type: 'READ_TAB', tabId, fromSelection: true });
    await expect.poll(async () => (await session(context))?.sentenceCount).toBe(1);
    await expect
      .poll(async () => (await session(context))?.state, { timeout: 15_000 })
      .toMatch(/playing|ended/);
  });

  test('two sessions are never both audible', async ({ context, extensionId }) => {
    await readFixture(context);
    const reader: Page = await context.newPage();
    await reader.goto(`chrome-extension://${extensionId}/reader.html?inpageTest=1`);
    await reader.waitForFunction(
      () => (window as { __inpage?: { state(): string | undefined } }).__inpage?.state() === 'idle',
    );
    await reader.evaluate(() =>
      (window as unknown as { __inpage: { play(): void } }).__inpage.play(),
    );
    await reader.waitForFunction(
      () => (window as unknown as { __inpage: { state(): string } }).__inpage.state() === 'playing',
    );
    await expectState(context, 'paused');
    // Starting web mode again pauses the reader page.
    await command(context, { type: 'PLAY' });
    await expectState(context, 'playing');
    await reader.waitForFunction(
      () => (window as unknown as { __inpage: { state(): string } }).__inpage.state() === 'paused',
    );
    // Overlap, if any, is bounded by message latency.
    const log = (await debugLog(context)).filter((e) => e.kind === 'status');
    const playing = new Map<string, boolean>();
    let both = 0;
    let since = 0;
    for (const e of log) {
      if (e.kind !== 'status') continue;
      playing.set(e.host, e.status.state === 'playing');
      const now = playing.get('offscreen') && playing.get('inpage');
      if (now && !since) since = e.at;
      if (!now && since) {
        both += e.at - since;
        since = 0;
      }
    }
    expect(both).toBeLessThan(250);
  });
});
