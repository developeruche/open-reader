import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page, Worker } from '@playwright/test';
import type { DebugEvent } from '@/runtime/orchestrator';
import type { SessionInfo } from '@/runtime/protocol';
import { expect } from './fixtures';

export const FIXTURE_ORIGIN = 'https://fixtures.test';

/** Serves tests/fixtures/web/* at https://fixtures.test/ (no network). */
export async function serveFixtures(context: BrowserContext): Promise<void> {
  await context.route(`${FIXTURE_ORIGIN}/**`, (route) => {
    const name = new URL(route.request().url()).pathname.slice(1) || 'index.html';
    try {
      route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: readFileSync(path.resolve('tests/fixtures/web', name)),
      });
    } catch {
      route.fulfill({ status: 404, body: 'not found' });
    }
  });
}

interface OpenReaderDebug {
  orch: { session: SessionInfo | null };
  debugLog: DebugEvent[];
  command(c: unknown): Promise<void>;
  keyboardCommand(name: string): Promise<void>;
  closeOffscreen(): Promise<void>;
  offscreenExists(): Promise<boolean>;
}

declare const __openReader: OpenReaderDebug;
/** Only the bit of the chrome API these helpers evaluate inside the worker. */
declare const chrome: { tabs: { query(q: object): Promise<{ id?: number; url?: string }[]> } };

export async function currentWorker(context: BrowserContext): Promise<Worker> {
  const sw = context.serviceWorkers().find((w) => w.url().endsWith('/background.js'));
  return sw ?? (await context.waitForEvent('serviceworker'));
}

export async function session(context: BrowserContext): Promise<SessionInfo | null> {
  return retrying(async () =>
    (await currentWorker(context)).evaluate(() => __openReader.orch.session),
  );
}

/** Evaluations fail while the worker restarts ("Service worker restarted"); retry briefly. */
async function retrying<T>(fn: () => Promise<T>, attempts = 10): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts || !String(e).includes('restarted')) throw e;
      await new Promise((r) => setTimeout(r, 300));
    }
  }
}

export async function command(context: BrowserContext, c: unknown): Promise<void> {
  await retrying(async () =>
    (await currentWorker(context)).evaluate((x) => __openReader.command(x), c),
  );
}

export async function keyboard(context: BrowserContext, name: string): Promise<void> {
  await (await currentWorker(context)).evaluate((n) => __openReader.keyboardCommand(n), name);
}

export async function debugLog(context: BrowserContext): Promise<DebugEvent[]> {
  return (await currentWorker(context)).evaluate(() => __openReader.debugLog);
}

export async function offscreenExists(context: BrowserContext): Promise<boolean> {
  return (await currentWorker(context)).evaluate(() => __openReader.offscreenExists());
}

export async function closeOffscreen(context: BrowserContext): Promise<void> {
  await (await currentWorker(context)).evaluate(() => __openReader.closeOffscreen());
}

export async function tabIdOf(context: BrowserContext, urlPrefix: string): Promise<number> {
  const sw = await currentWorker(context);
  const id = await sw.evaluate(
    async (prefix) => (await chrome.tabs.query({})).find((t) => t.url?.startsWith(prefix))?.id,
    urlPrefix,
  );
  if (id === undefined) throw new Error(`no tab for ${urlPrefix}`);
  return id;
}

/** Opens the blog fixture and starts reading it in web mode. */
export async function readFixture(context: BrowserContext, file = 'blog.html'): Promise<Page> {
  await serveFixtures(context);
  const page = await context.newPage();
  await page.goto(`${FIXTURE_ORIGIN}/${file}`);
  const tabId = await tabIdOf(context, `${FIXTURE_ORIGIN}/${file}`);
  await command(context, { type: 'READ_TAB', tabId });
  await expectState(context, 'playing');
  return page;
}

export async function expectState(
  context: BrowserContext,
  state: string,
  timeout = 15_000,
): Promise<void> {
  await expect.poll(async () => (await session(context))?.state, { timeout }).toBe(state);
}

export async function sentence(context: BrowserContext): Promise<number> {
  return (await session(context))?.cursor.sentence ?? -1;
}
