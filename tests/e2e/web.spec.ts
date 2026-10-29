import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import {
  command,
  expectState,
  FIXTURE_ORIGIN,
  serveFixtures,
  session,
  tabIdOf,
} from './runtime-helpers';

async function open(
  context: BrowserContext,
  file: string,
  viewport = { width: 1000, height: 800 },
): Promise<{ page: Page; tabId: number }> {
  await serveFixtures(context);
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(`${FIXTURE_ORIGIN}/${file}`);
  return { page, tabId: await tabIdOf(context, `${FIXTURE_ORIGIN}/${file}`) };
}

const word = (page: Page) => page.evaluate(() => document.documentElement.dataset.orWord ?? '');
const sentenceText = (page: Page) =>
  page.evaluate(() => document.documentElement.dataset.orSentence ?? '');

test.describe('web mode', () => {
  test('highlights the current sentence and word, advancing in reading order', async ({
    context,
  }) => {
    const { page, tabId } = await open(context, 'blog.html');
    await command(context, { type: 'READ_TAB', tabId });
    await expectState(context, 'playing');
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) {
      const w = await word(page);
      if (w && w !== seen.at(-1)) seen.push(w);
      await page.waitForTimeout(50);
    }
    expect(seen.length).toBeGreaterThan(5);
    // Every highlighted word appears in the article, in order.
    const text = await page.evaluate(() =>
      document.querySelector('article')!.textContent!.replace(/\s+/g, ' '),
    );
    let pos = 0;
    for (const w of seen) {
      const at = text.indexOf(w, pos);
      expect(at, `"${w}" after position ${pos}`).toBeGreaterThanOrEqual(0);
      pos = at;
    }
    expect(await sentenceText(page)).not.toBe('');
    expect(await page.evaluate(() => document.documentElement.dataset.orVariant)).toBe('light');
    // Nav and footer are never read.
    expect(seen.join(' ')).not.toMatch(/Home|Copyright/);
  });

  test('follow-scroll keeps the sentence in view and pauses when the user scrolls', async ({
    context,
  }) => {
    const { page, tabId } = await open(context, 'long.html', { width: 900, height: 420 });
    await command(context, { type: 'READ_TAB', tabId });
    await expectState(context, 'playing');
    await command(context, { type: 'SEEK', sentence: 12 });
    await expect
      .poll(() => page.evaluate(() => window.scrollY), { timeout: 10_000 })
      .toBeGreaterThan(100);
    // The highlighted sentence is inside the viewport.
    const inView = () =>
      page.evaluate(() => {
        const s = document.documentElement.dataset.orSentence ?? '';
        if (!s) return false;
        const el = [...document.querySelectorAll('p,li,h2,td')].find((e) =>
          e.textContent!.replace(/\s+/g, ' ').includes(s.slice(0, 30)),
        );
        const r = el?.getBoundingClientRect();
        return !!r && r.bottom > 0 && r.top < innerHeight;
      });
    await expect.poll(inView, { timeout: 10_000 }).toBe(true);
    // A user scroll suspends following for 5 seconds.
    await page.mouse.move(400, 200);
    await page.mouse.wheel(0, -2000);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.orFollow))
      .toBe('suspended');
    await page.waitForTimeout(600); // let the wheel's own smooth scroll finish
    const y = await page.evaluate(() => window.scrollY);
    await command(context, { type: 'NEXT_BLOCK' });
    await page.waitForTimeout(800);
    expect(await page.evaluate(() => window.scrollY)).toBe(y);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.dataset.orFollow), { timeout: 8000 })
      .toBe('on');
  });

  test('keeps highlighting after a single-page app re-renders the article', async ({ context }) => {
    const { page, tabId } = await open(context, 'spa.html');
    await command(context, { type: 'READ_TAB', tabId });
    await expectState(context, 'playing');
    await expect.poll(() => word(page)).not.toBe('');
    await page.evaluate(() => (window as unknown as { rerender(): void }).rerender());
    await page.waitForTimeout(500);
    const before = await word(page);
    await expect.poll(() => word(page), { timeout: 10_000 }).not.toBe(before);
    // The highlighted word is in the live DOM (the new nodes).
    const w = await word(page);
    expect(
      await page.evaluate((x) => document.getElementById('app')!.textContent!.includes(x), w),
    ).toBe(true);
  });

  test('uses the dark highlight variant on dark pages', async ({ context }) => {
    const { page, tabId } = await open(context, 'dark.html');
    await command(context, { type: 'READ_TAB', tabId });
    await expectState(context, 'playing');
    await expect.poll(() => word(page)).not.toBe('');
    expect(await page.evaluate(() => document.documentElement.dataset.orVariant)).toBe('dark');
  });

  test('Alt+click reads from the clicked word', async ({ context }) => {
    const { page, tabId } = await open(context, 'blog.html');
    await command(context, { type: 'READ_TAB', tabId });
    await expectState(context, 'playing');
    const target = page.locator('article p').nth(1);
    const box = (await target.boundingBox())!;
    await page.keyboard.down('Alt');
    await page.mouse.click(box.x + 40, box.y + 8);
    await page.keyboard.up('Alt');
    await expect
      .poll(async () => sentenceText(page), { timeout: 10_000 })
      .toContain('A signing device can show the real fee');
  });

  test('in-page keys move by sentence and the mini player appears', async ({ context }) => {
    const { page, tabId } = await open(context, 'blog.html');
    await command(context, { type: 'READ_TAB', tabId });
    await expectState(context, 'playing');
    await expect(page.locator('open-reader-mini')).toBeAttached();
    await page.locator('article h1').click();
    await page.keyboard.press(' ');
    await expectState(context, 'paused');
    const at = (await session(context))!.cursor.sentence;
    await page.keyboard.press('k');
    await expect.poll(async () => (await session(context))!.cursor.sentence).toBe(at + 1);
    await page.keyboard.press('=');
    await expect.poll(async () => (await session(context))!.settings.rate).toBe(1.25);
    // Mini player play button (closed shadow root): click by position.
    const mini = (await page.locator('open-reader-mini').boundingBox())!;
    await page.mouse.click(mini.x + 40, mini.y + mini.height / 2);
    await expectState(context, 'playing');
  });

  test('the side panel shows the article and seeks on click', async ({ context, extensionId }) => {
    const { tabId } = await open(context, 'blog.html');
    await command(context, { type: 'READ_TAB', tabId });
    await expectState(context, 'playing');
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
    await expect(panel.getByRole('heading', { level: 1 })).toHaveText(
      'How a PSBT moves between wallets',
    );
    await expect(panel.getByText('On-device · Test tone')).toBeVisible();
    await expect(panel.locator('[data-current-sentence]')).toBeVisible();
    await panel.getByText('That closes the fee-inflation attack', { exact: false }).click();
    await expect
      .poll(async () => panel.locator('[data-current-sentence]').textContent(), { timeout: 10_000 })
      .toContain('That closes the fee-inflation attack');
    await panel.getByRole('tab', { name: 'Outline' }).click();
    await panel.getByRole('button', { name: 'The four roles' }).click();
    await panel.getByRole('tab', { name: 'Reader' }).click();
    await expect
      .poll(async () => panel.locator('[data-current-sentence]').textContent())
      .toContain('The four roles');
  });

  test('the side panel offers to read the page when nothing is playing', async ({
    context,
    extensionId,
  }) => {
    const { tabId } = await open(context, 'docs.html');
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
    await panel.getByRole('button', { name: 'Read this page' }).click();
    await expectState(context, 'playing');
    await expect(panel.getByRole('heading', { level: 1 })).toHaveText(
      'Signing a PSBT with the CLI',
    );
  });

  test('resumes a page where it was left', async ({ context }) => {
    const { page, tabId } = await open(context, 'long.html');
    await command(context, { type: 'READ_TAB', tabId });
    await expectState(context, 'playing');
    await command(context, { type: 'SEEK', sentence: 9 });
    await expect.poll(async () => (await session(context))!.cursor.sentence).toBe(9);
    await command(context, { type: 'STOP' });
    await page.reload();
    const tab2 = await tabIdOf(context, `${FIXTURE_ORIGIN}/long.html`);
    await command(context, { type: 'READ_TAB', tabId: tab2 });
    await expectState(context, 'playing');
    expect((await session(context))!.cursor.sentence).toBeGreaterThanOrEqual(9);
  });

  test('skips references, tables and code blocks by default', async ({ context, extensionId }) => {
    const { tabId } = await open(context, 'wiki.html');
    await command(context, { type: 'READ_TAB', tabId });
    await expectState(context, 'playing');
    const panel = await context.newPage();
    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
    // References are visible but muted (not seekable); the session's sentence count excludes them.
    await expect(panel.getByText('Wallet survey, 2020.')).toBeVisible();
    const s = (await session(context))!;
    expect(s.sentenceCount).toBeLessThan(12);
  });
});
