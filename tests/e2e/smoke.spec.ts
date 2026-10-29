import { expect, test } from './fixtures';

test('loads the extension and opens the side panel page', async ({ context, extensionId }) => {
  expect(extensionId).toMatch(/^[a-p]{32}$/);
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByRole('heading', { name: 'Nothing is playing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Read this page' })).toBeVisible();
});
