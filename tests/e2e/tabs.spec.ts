/** The side panel follows the tab in front (user report after 1.0.0). */
import { expect, test } from './fixtures';
import {
  command,
  expectState,
  FIXTURE_ORIGIN,
  serveFixtures,
  session,
  tabIdOf,
} from './runtime-helpers';

test('switching to another article offers it, and reading it replaces the old one', async ({
  context,
  extensionId,
}) => {
  await serveFixtures(context);
  const a = await context.newPage();
  await a.goto(`${FIXTURE_ORIGIN}/blog.html`);
  const tabA = await tabIdOf(context, `${FIXTURE_ORIGIN}/blog.html`);
  await command(context, { type: 'READ_TAB', tabId: tabA });
  await expectState(context, 'playing');
  await command(context, { type: 'PAUSE' });

  const b = await context.newPage();
  await b.goto(`${FIXTURE_ORIGIN}/docs.html`);
  const tabB = await tabIdOf(context, `${FIXTURE_ORIGIN}/docs.html`);
  // The panel is pinned to tab B the way the real side panel follows the tab in front.
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html?tabId=${tabB}`);
  const bar = panel.getByRole('region', { name: 'Now playing' });
  await expect(bar).toContainText('Paused in another tab');
  await expect(panel.getByRole('heading', { name: await b.title() })).toBeVisible();
  await panel.getByRole('button', { name: 'Read this page' }).click();
  await expect.poll(async () => (await session(context))?.tabId).toBe(tabB);
  await expectState(context, 'playing');
  await expect(bar).toHaveCount(0);
  await expect(panel.getByRole('region', { name: 'Playback' })).toBeVisible();

  // Closing the tab ends its session; the panel goes back to offering a page.
  await b.close();
  await expect.poll(async () => await session(context)).toBeNull();
});

test('navigating the session tab to another page ends the old session', async ({ context }) => {
  await serveFixtures(context);
  const a = await context.newPage();
  await a.goto(`${FIXTURE_ORIGIN}/blog.html`);
  const tabA = await tabIdOf(context, `${FIXTURE_ORIGIN}/blog.html`);
  await command(context, { type: 'READ_TAB', tabId: tabA });
  await expectState(context, 'playing');
  await a.goto(`${FIXTURE_ORIGIN}/docs.html`);
  await expect.poll(async () => await session(context)).toBeNull();
});

test('the Open a PDF button opens the reader, not Settings', async ({ context, extensionId }) => {
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const opened = context.waitForEvent('page');
  await panel.getByRole('button', { name: 'Open a PDF', exact: true }).click();
  const reader = await opened;
  await reader.waitForLoadState();
  expect(reader.url()).toContain('/reader.html');
  await expect(reader.getByLabel('Choose a PDF')).toBeAttached();
});
