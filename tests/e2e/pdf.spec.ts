import AxeBuilder from '@axe-core/playwright';
import type { BrowserContext, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { FIXTURE_ORIGIN, serveFixtures } from './runtime-helpers';

interface ReaderHook {
  state: {
    phase: string;
    state: string;
    sentence: number;
    sentences: number;
    firstPageMs: number;
    layoutMs: number;
    pages: number;
  };
  nav: {
    sentences: {
      block: { text: string; type: string };
      sentence: { start: number; end: number };
    }[];
  };
  send(e: unknown): void;
}

async function openPdf(
  context: BrowserContext,
  extensionId: string,
  name: string,
  viewport = { width: 1200, height: 900 },
): Promise<Page> {
  await serveFixtures(context);
  const page = await context.newPage();
  await page.setViewportSize(viewport);
  await page.goto(
    `chrome-extension://${extensionId}/reader.html?src=${encodeURIComponent(`${FIXTURE_ORIGIN}/pdf/${name}.pdf`)}`,
  );
  await page.waitForFunction(
    () => (window as unknown as { __reader?: ReaderHook }).__reader?.state.phase === 'ready',
    null,
    { timeout: 30_000 },
  );
  return page;
}

const reader = <R>(page: Page, fn: (r: ReaderHook) => R) =>
  page.evaluate(`(${fn.toString()})(window.__reader)`) as Promise<R>;
const texts = (page: Page) =>
  reader(page, (r) =>
    r.nav.sentences.map((s) => s.block.text.slice(s.sentence.start, s.sentence.end)),
  );
const data = (page: Page, k: string) =>
  page.evaluate((key) => document.documentElement.dataset[key] ?? '', k);

test.describe('document mode (PDF)', () => {
  test('reads two columns in order and puts the cursor on the right word on page 2', async ({
    context,
    extensionId,
  }) => {
    const page = await openPdf(context, extensionId, 'two-column');
    const all = await texts(page);
    expect(all.join(' ')).not.toContain('Spike Journal of Reading Order');
    const order = [
      'Two columns, one voice',
      'A partially signed transaction',
      'The creator proposes',
      'A hardware wallet',
      'Taproot lets',
      'Only on the second page',
      'Fees are a market',
    ];
    let pos = -1;
    for (const o of order) {
      const i = all.findIndex((t) => t.startsWith(o));
      expect(i, o).toBeGreaterThan(pos);
      pos = i;
    }
    const zebra = all.findIndex((t) => t.includes('zebra'));
    await page.evaluate((i) => {
      const r = (window as unknown as { __reader: ReaderHook }).__reader;
      r.send({ type: 'SEEK', sentence: i });
      r.send({ type: 'PLAY' });
    }, zebra);
    await expect
      .poll(() => data(page, 'orWord'), { timeout: 20_000, intervals: [20] })
      .toBe('zebra');
    await page.evaluate(() =>
      (window as unknown as { __reader: ReaderHook }).__reader.send({ type: 'PAUSE' }),
    );
    expect(await data(page, 'orWordPage')).toBe('2');
    expect(Number(await data(page, 'orWordX'))).toBeGreaterThan(0.5);
    expect(await data(page, 'orSentence')).toContain('the zebra appear');
  });

  test('skips headers, footers and page numbers', async ({ context, extensionId }) => {
    const page = await openPdf(context, extensionId, 'headers-footers');
    const all = (await texts(page)).join(' ');
    expect(all).not.toMatch(/Field notes on fees|Page \d of 5/);
    expect(await reader(page, (r) => r.state.sentences)).toBeGreaterThan(5);
  });

  test('skips references by default and reads them when the rule is turned off', async ({
    context,
    extensionId,
  }) => {
    const page = await openPdf(context, extensionId, 'references');
    expect((await texts(page)).join(' ')).not.toContain('Wallet survey');
    expect((await texts(page)).join(' ')).toContain('Figure 1.');
    await page.getByRole('button', { name: 'Show reading options' }).click();
    await page.getByRole('switch', { name: 'Skip references' }).click();
    await expect.poll(async () => (await texts(page)).join(' ')).toContain('Wallet survey');
  });

  test('click a word to read from there', async ({ context, extensionId }) => {
    const page = await openPdf(context, extensionId, 'two-column');
    const span = page.locator('.page[data-page-number="1"] .textLayer span', {
      hasText: 'A hardware wallet can show',
    });
    await span.waitFor();
    const box = (await span.boundingBox())!;
    await page.mouse.click(box.x + 30, box.y + box.height / 2);
    await expect
      .poll(() => data(page, 'orSentence'), { timeout: 20_000 })
      .toContain('A hardware wallet');
    expect(await reader(page, (r) => r.state.state)).toMatch(/playing|buffering|preparing|seeking/);
  });

  test('resumes where it was left after a reload', async ({ context, extensionId }) => {
    const page = await openPdf(context, extensionId, 'single-column');
    await page.evaluate(() => {
      const r = (window as unknown as { __reader: ReaderHook }).__reader;
      r.send({ type: 'SEEK', sentence: 4 });
      r.send({ type: 'PLAY' });
    });
    await expect
      .poll(() => reader(page, (r) => r.state.sentence), { timeout: 15_000 })
      .toBeGreaterThanOrEqual(4);
    await page.evaluate(() =>
      (window as unknown as { __reader: ReaderHook }).__reader.send({ type: 'PAUSE' }),
    );
    await page.waitForTimeout(500);
    const at = await reader(page, (r) => r.state.sentence);
    const docUrl = page.url();
    await page.reload();
    await page.waitForFunction(
      () => (window as unknown as { __reader?: ReaderHook }).__reader?.state.phase === 'ready',
    );
    expect(await reader(page, (r) => r.state.sentence)).toBe(at);
    expect(docUrl).toContain('reader.html');
  });

  test('opens a PDF from the file picker and lists it under recent documents', async ({
    context,
    extensionId,
  }) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/reader.html`);
    await expect(page.getByRole('heading', { name: 'Open a PDF' })).toBeVisible();
    await page.getByLabel('Choose a PDF').setInputFiles('tests/fixtures/pdf/single-column.pdf');
    await page.waitForFunction(
      () => (window as unknown as { __reader?: ReaderHook }).__reader?.state.phase === 'ready',
    );
    expect(page.url()).toMatch(/\?doc=[0-9a-f]{64}/);
    await page.evaluate(() => {
      const r = (window as unknown as { __reader: ReaderHook }).__reader;
      r.send({ type: 'SEEK', sentence: 1 });
    });
    await page.waitForTimeout(500);
    const empty = await context.newPage();
    await empty.goto(`chrome-extension://${extensionId}/reader.html`);
    await expect(empty.getByRole('heading', { name: 'Recent documents' })).toBeVisible();
    await empty.getByRole('link', { name: /single-column|Untitled/ }).click();
    await empty.waitForFunction(
      () => (window as unknown as { __reader?: ReaderHook }).__reader?.state.phase === 'ready',
    );
  });

  test('performance: a 100-page PDF shows page 1 within 2 s and analyzes under 50 ms per page', async ({
    context,
    extensionId,
  }) => {
    const page = await openPdf(context, extensionId, 'hundred-pages');
    const st = await reader(page, (r) => r.state);
    console.log(`100 pages: first page ${st.firstPageMs} ms, layout ${st.layoutMs} ms`);
    expect(st.pages).toBe(100);
    expect(st.firstPageMs).toBeLessThanOrEqual(2000);
    expect(st.layoutMs / st.pages).toBeLessThanOrEqual(50);
  });

  test('the loaded reader has no serious accessibility violations', async ({
    context,
    extensionId,
  }) => {
    const page = await openPdf(context, extensionId, 'two-column');
    const r = await new AxeBuilder({ page })
      .exclude('.pdfViewer')
      .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
      .analyze();
    expect(
      r.violations
        .filter((v) => v.impact === 'serious' || v.impact === 'critical')
        .map((v) => v.id),
    ).toEqual([]);
  });
});
