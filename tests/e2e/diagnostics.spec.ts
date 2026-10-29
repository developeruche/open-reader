import { expect, test } from './fixtures';
import { readFixture } from './runtime-helpers';

test('Diagnostics shows live engine numbers and a text-free log while reading', async ({
  context,
  extensionId,
}) => {
  const article = await readFixture(context);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html#diagnostics`);
  await expect(page.getByRole('heading', { level: 1, name: 'Diagnostics' })).toBeVisible();
  const stat = (name: string) =>
    page
      .locator('dt')
      .filter({ hasText: new RegExp(`^${name}$`) })
      .locator('+ dd');
  await expect(stat('State')).toHaveText('playing');
  await expect(stat('Engine')).toContainText('test');
  await expect
    .poll(async () => Number((await stat('Buffer ahead').textContent())?.split(' ')[0]))
    .toBeGreaterThanOrEqual(20);
  await expect(stat('Stalls')).toHaveText('0');
  const log = page.getByRole('list', { name: 'Diagnostics log' });
  await expect(log).toContainText('command READ_TAB');
  await expect(log).toContainText('state playing');
  // No document text in the log.
  const title = await article.title();
  await expect(log).not.toContainText(title);
  await expect(log).not.toContainText('PSBT');

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy diagnostics' }).click();
  await expect(page.getByText('Diagnostics copied').first()).toBeVisible();
  const json = await page.evaluate(() => navigator.clipboard.readText());
  const parsed = JSON.parse(json) as { report: { stats: { engine: string }[] } };
  expect(parsed.report.stats[0]?.engine).toBe('test');
  expect(json).not.toContain('PSBT');
});
