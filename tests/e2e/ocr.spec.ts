/** OCR for scanned PDFs (M13): offline recognition, reading order, cursor, and the cache. */
import type { BrowserContext, Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { expect, test } from './fixtures';

interface ReaderHook {
  state: { phase: string; state: string; ocr: unknown; ocrPages: number[]; sentences: number };
  nav?: { sentences: { block: { text: string }; sentence: { start: number; end: number } }[] };
  send(e: unknown): void;
}

const golden = JSON.parse(readFileSync('tests/fixtures/pdf/scanned.golden.json', 'utf8')) as {
  blocks: string[];
};

/** Word-level similarity: share of expected words found in order. */
function recall(expected: string, actual: string): number {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z ]/g, '')
      .split(/\s+/)
      .filter(Boolean);
  const want = norm(expected);
  const got = norm(actual);
  let j = 0;
  let hit = 0;
  for (const w of want) {
    const k = got.indexOf(w, j);
    if (k >= 0) {
      hit++;
      j = k + 1;
    }
  }
  return hit / want.length;
}

async function openScanned(context: BrowserContext, extensionId: string): Promise<Page> {
  const pdf = readFileSync('tests/fixtures/pdf/scanned.pdf');
  // Offline: the PDF comes from a route, everything else that is not the extension fails.
  const outbound: string[] = [];
  context.on('request', (r) => {
    const u = r.url();
    if (!u.startsWith('chrome-extension://') && !u.startsWith('https://fixtures.test/'))
      outbound.push(u);
  });
  await context.route('**/*', (route) => {
    const u = route.request().url();
    if (u.startsWith('chrome-extension://')) return route.continue();
    if (u === 'https://fixtures.test/scanned.pdf')
      return route.fulfill({
        status: 200,
        contentType: 'application/pdf',
        body: pdf,
        headers: { 'Access-Control-Allow-Origin': '*' },
      });
    return route.abort('internetdisconnected');
  });
  const page = await context.newPage();
  await page.goto(
    `chrome-extension://${extensionId}/reader.html?src=${encodeURIComponent('https://fixtures.test/scanned.pdf')}`,
  );
  await page.waitForFunction(
    () => (window as unknown as { __reader?: ReaderHook }).__reader?.state.phase === 'ready',
    null,
    { timeout: 30_000 },
  );
  (page as Page & { outbound?: string[] }).outbound = outbound;
  return page;
}

const reader = <R>(page: Page, fn: (r: ReaderHook) => R) =>
  page.evaluate(`(${fn.toString()})(window.__reader)`) as Promise<R>;

test('recognizes a scanned page offline, reads it in order with a word cursor, and caches it', async ({
  context,
  extensionId,
}) => {
  test.setTimeout(120_000);
  const page = await openScanned(context, extensionId);
  // The "Recognizing text…" status can come and go quickly; its rendering is unit-tested.
  await page.waitForFunction(
    () => {
      const r = (window as unknown as { __reader?: ReaderHook }).__reader;
      return !!r && r.state.ocr === null && r.state.ocrPages.length === 1 && r.state.sentences > 0;
    },
    null,
    { timeout: 90_000 },
  );
  const text = await reader(page, (r) =>
    (r.nav?.sentences ?? [])
      .map((s) => s.block.text.slice(s.sentence.start, s.sentence.end))
      .join(' '),
  );
  const score = recall(golden.blocks.join(' '), text);
  console.log(`OCR recall ${(score * 100).toFixed(0)}%: ${text}`);
  expect(score).toBeGreaterThanOrEqual(0.9);
  // The heading is its own block, read first.
  expect(recall(golden.blocks[0] ?? '', text.split('.')[0] ?? '')).toBeGreaterThanOrEqual(0.75);

  // Our OCR text layer is on the page; the cursor lands on recognized words.
  await expect(
    page.locator('.page[data-page-number="1"] .textLayer.or-ocr span').first(),
  ).toBeAttached();
  await page.evaluate(() =>
    (window as unknown as { __reader: ReaderHook }).__reader.send({ type: 'PLAY' }),
  );
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.orWord ?? ''), {
      timeout: 20_000,
    })
    .toMatch(/\w{2,}/);
  expect(await page.evaluate(() => document.documentElement.dataset.orWordPage)).toBe('1');
  const word = await page.evaluate(() => document.documentElement.dataset.orWord ?? '');
  expect(golden.blocks.join(' ').toLowerCase()).toContain(
    word.toLowerCase().replace(/[^a-z]/g, ''),
  );
  expect((page as Page & { outbound?: string[] }).outbound).toEqual([]);

  // Reopening uses the cached result: no recognition step.
  await page.reload();
  await page.waitForFunction(
    () => (window as unknown as { __reader?: ReaderHook }).__reader?.state.ocrPages.length === 1,
    null,
    { timeout: 10_000 },
  );
  await expect(page.getByText(/Recognizing text on page/)).toHaveCount(0);
});
