import { expect, test } from './fixtures';

test('loads the extension and opens the side panel page', async ({ context, extensionId }) => {
  // The manifest key pins the ID, so any folder loads as the same extension (and keeps its data).
  expect(extensionId).toBe('ciacahokbkkhcpoefghbmnmilbaalcem');
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  await expect(page.getByRole('heading', { name: 'Open Reader' })).toBeVisible();
  // Opened as a tab, the panel's "tab in front" is itself, an extension page it can't read.
  await expect(page.getByRole('heading', { name: "This page can't be read aloud" })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open a PDF from your computer' })).toBeVisible();
});
