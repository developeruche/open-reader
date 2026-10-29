import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';

const PAGES = [
  { name: 'sidepanel', width: 400, height: 860 },
  { name: 'reader', width: 1280, height: 860 },
  { name: 'options', width: 1280, height: 860 },
  { name: 'onboarding', width: 1100, height: 800 },
  { name: 'gallery', width: 1000, height: 1100 },
] as const;

async function open(
  page: Page,
  extensionId: string,
  name: string,
  colorScheme: 'light' | 'dark' = 'light',
) {
  await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
  await page.goto(`chrome-extension://${extensionId}/${name}.html`);
  await page.locator('#root > *').first().waitFor();
  await page.evaluate(() => document.fonts.ready);
}

async function seriousViolations(page: Page) {
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  return r.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
}

for (const scheme of ['light', 'dark'] as const) {
  for (const p of PAGES) {
    test(`${p.name} (${scheme}) has no serious accessibility violations`, async ({
      context,
      extensionId,
    }) => {
      const page = await context.newPage();
      await page.setViewportSize({ width: p.width, height: p.height });
      await open(page, extensionId, p.name, scheme);
      expect(await seriousViolations(page)).toEqual([]);
    });

    test(`${p.name} (${scheme}) matches its screenshot`, async ({ context, extensionId }) => {
      const page = await context.newPage();
      await page.setViewportSize({ width: p.width, height: p.height });
      await open(page, extensionId, p.name, scheme);
      await expect(page).toHaveScreenshot(`${p.name}-${scheme}.png`, { maxDiffPixelRatio: 0.01 });
    });
  }
}

test('side panel: keyboard reaches the transport and the speed popover during a session', async ({
  context,
  extensionId,
}) => {
  const { readFixture, session } = await import('./runtime-helpers');
  await readFixture(context);
  const tabId = (await session(context))!.tabId!;
  const page = await context.newPage();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  for (let i = 0; i < 12 && !(await pause.evaluate((el) => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(pause).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  const speed = page.getByRole('button', { name: 'Speed 1.0×' });
  await speed.focus();
  await page.keyboard.press('Enter');
  const slider = page.getByRole('slider', { name: 'Speed' });
  await slider.focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  await expect(slider).toHaveAttribute('aria-valuenow', '1.1');
  await page.keyboard.press('Escape');
  await expect.poll(async () => (await session(context))!.settings.rate).toBe(1.1);
  expect(await seriousViolations(page)).toEqual([]);
});

test('options: sections are reachable from the keyboard', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await open(page, extensionId, 'options');
  await page.getByRole('link', { name: 'Shortcuts' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'Shortcuts' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Shortcuts' })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('reader: floating transport and drawers work from the keyboard', async ({
  context,
  extensionId,
}) => {
  const { FIXTURE_ORIGIN, serveFixtures } = await import('./runtime-helpers');
  await serveFixtures(context);
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(
    `chrome-extension://${extensionId}/reader.html?src=${encodeURIComponent(`${FIXTURE_ORIGIN}/pdf/two-column.pdf`)}`,
  );
  const follow = page.getByRole('button', { name: 'Follow' });
  await follow.waitFor();
  await follow.focus();
  await page.keyboard.press('Enter');
  await expect(follow).toHaveAttribute('aria-pressed', 'false');
  const rules = page.getByRole('button', { name: 'Show reading rules' });
  await rules.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('complementary', { name: 'Reading rules' })).toBeVisible();
  await page.getByRole('switch', { name: 'Skip references' }).focus();
  await page.keyboard.press('Space');
  await expect(page.getByRole('switch', { name: 'Skip references' })).toHaveAttribute(
    'aria-checked',
    'false',
  );
  await page.getByRole('button', { name: 'Play', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
});

test('theme preference persists across pages', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await open(page, extensionId, 'options');
  await page.getByRole('combobox', { name: 'Theme' }).click();
  await page.getByRole('option', { name: 'Dark' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const other = await context.newPage();
  await open(other, extensionId, 'sidepanel');
  await expect(other.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await other.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe(
    'rgb(11, 11, 11)',
  );
});

test('onboarding advances with the keyboard', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await open(page, extensionId, 'onboarding');
  await page.getByRole('button', { name: 'Get started' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { name: /^Download/ })).toBeVisible();
  // Continue stays disabled until the model is downloaded.
  await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled();
});

test('mini player renders inside a closed shadow root', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await open(page, extensionId, 'gallery');
  const host = page.getByTestId('mini-player-host');
  await expect(host).toBeAttached();
  expect(await host.evaluate((h) => h.shadowRoot)).toBeNull();
  const box = await host.boundingBox();
  expect(box?.height).toBe(44);
});
