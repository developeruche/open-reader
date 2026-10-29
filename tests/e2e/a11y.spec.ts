/**
 * Final accessibility audit (M14): axe (WCAG 2.2 AA) over every Options section, the side panel in
 * a session (each tab, the export dialog), and the reader with a PDF, its drawers and dialogs, in
 * both color schemes. Serious and critical findings fail; moderate ones are listed.
 */
import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { FIXTURE_ORIGIN, readFixture, serveFixtures, session } from './runtime-helpers';

async function audit(page: Page, label: string): Promise<string[]> {
  await page.evaluate(() => document.fonts.ready);
  const r = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const fmt = (v: (typeof r.violations)[number]) =>
    `${label}: ${v.id} (${v.impact}) ${v.nodes
      .slice(0, 3)
      .map((n) => n.target.join(' '))
      .join(', ')}`;
  const moderate = r.violations.filter((v) => v.impact === 'moderate' || v.impact === 'minor');
  if (moderate.length) console.log(moderate.map(fmt).join('\n'));
  return r.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map(fmt);
}

const SECTIONS = [
  'voices',
  'playback',
  'rules',
  'pronunciations',
  'shortcuts',
  'storage',
  'diagnostics',
  'about',
];

for (const scheme of ['light', 'dark'] as const) {
  test(`options: every section (${scheme})`, async ({ context, extensionId }) => {
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    const found: string[] = [];
    for (const s of SECTIONS) {
      await page.goto(`chrome-extension://${extensionId}/options.html#${s}`);
      await page.locator('#section-title').waitFor();
      await page.waitForTimeout(150);
      found.push(...(await audit(page, s)));
    }
    expect(found).toEqual([]);
  });

  test(`side panel in a session: tabs and export dialog (${scheme})`, async ({
    context,
    extensionId,
  }) => {
    await readFixture(context);
    const tabId = (await session(context))?.tabId;
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabId}`);
    await page.getByRole('button', { name: 'Pause', exact: true }).waitFor();
    const found = await audit(page, 'reader tab');
    for (const tab of ['Outline', 'Settings']) {
      await page.getByRole('tab', { name: tab }).click();
      found.push(...(await audit(page, `${tab} tab`)));
    }
    await page.getByRole('button', { name: 'Export audiobook…' }).click();
    await page.getByRole('dialog').waitFor();
    found.push(...(await audit(page, 'export dialog')));
    expect(found).toEqual([]);
  });

  test(`reader with a PDF: drawers and export dialog (${scheme})`, async ({
    context,
    extensionId,
  }) => {
    await serveFixtures(context);
    const page = await context.newPage();
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto(
      `chrome-extension://${extensionId}/reader.html?src=${encodeURIComponent(`${FIXTURE_ORIGIN}/pdf/two-column.pdf`)}`,
    );
    await page.waitForFunction(
      () =>
        (window as { __reader?: { state: { phase: string } } }).__reader?.state.phase === 'ready',
    );
    const found = await audit(page, 'reader');
    await page.getByRole('tab', { name: 'Outline' }).click();
    found.push(...(await audit(page, 'outline tab')));
    await page.getByRole('button', { name: 'Show reading options' }).click();
    found.push(...(await audit(page, 'rules drawer')));
    await page.getByRole('button', { name: 'Export audiobook…' }).click();
    await page.getByRole('dialog').waitFor();
    found.push(...(await audit(page, 'export dialog')));
    expect(found).toEqual([]);
  });
}

test('the empty reader and the storage confirmation', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/reader.html`);
  await page.getByRole('heading', { name: 'Open a PDF' }).waitFor();
  const found = await audit(page, 'empty reader');
  await page.goto(`chrome-extension://${extensionId}/options.html#storage`);
  await page.getByRole('button', { name: 'Remove stored PDFs' }).click();
  await page.getByRole('dialog').waitFor();
  found.push(...(await audit(page, 'remove PDFs dialog')));
  expect(found).toEqual([]);
});
