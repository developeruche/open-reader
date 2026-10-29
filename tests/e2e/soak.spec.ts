/**
 * Soak test (PLAN.md §9.1, M10): reads a long generated article end to end and checks the SLOs that
 * only show over time: no stalls, ≥ 20 s buffered ahead, highlight drift ≤ 50 ms, positions saved.
 * `pnpm test:soak` runs 10 minutes; the regular E2E run uses 1 minute (SOAK_MINUTES).
 */
import type { Worker } from '@playwright/test';
import type { DiagnosticsReport } from '@/runtime/orchestrator';
import { expect, test } from './fixtures';
import {
  command,
  currentWorker,
  debugLog,
  expectState,
  FIXTURE_ORIGIN,
  session,
  tabIdOf,
} from './runtime-helpers';

const MINUTES = Number(process.env.SOAK_MINUTES ?? 1);
/** TestEngine speaks 60 ms per character at 1×. */
const CHARS = Math.ceil((MINUTES * 60) / 0.06) + 2000;

const SENTENCES = [
  'A partially signed transaction travels between wallets until every signer has added what it knows.',
  'The updater fills in previous outputs and derivation paths so that each signer can check the amounts.',
  'Hardware wallets show the destination and the fee before they sign anything at all.',
  'Once enough signatures are present, the finalizer assembles the witness and the transaction is broadcast.',
  'Nothing in this process requires a wallet to reveal its private keys to anybody else.',
];

function article(): string {
  const paras: string[] = [];
  let chars = 0;
  for (let p = 0; chars < CHARS; p++) {
    const text = Array.from(
      { length: 4 },
      (_, i) => SENTENCES[(p + i) % SENTENCES.length] ?? '',
    ).join(' ');
    chars += text.length;
    paras.push(p % 6 === 0 ? `<h2>Part ${p / 6 + 1}</h2><p>${text}</p>` : `<p>${text}</p>`);
  }
  return `<!doctype html><html lang="en"><head><title>Soak</title></head><body><article><h1>A long read</h1>${paras.join('')}</article></body></html>`;
}

declare const __openReader: { orch: { diagnostics(): DiagnosticsReport } };

const report = (sw: Worker) => sw.evaluate(() => __openReader.orch.diagnostics());

test(`soak: ${MINUTES} min without stalls, with a full buffer and no drift`, async ({
  context,
}) => {
  test.setTimeout((MINUTES * 60 + 90) * 1000);
  const html = article();
  await context.route(`${FIXTURE_ORIGIN}/soak.html`, (r) =>
    r.fulfill({ status: 200, contentType: 'text/html', body: html }),
  );
  const page = await context.newPage();
  await page.goto(`${FIXTURE_ORIGIN}/soak.html`);
  const t0 = Date.now();
  await command(context, {
    type: 'READ_TAB',
    tabId: await tabIdOf(context, `${FIXTURE_ORIGIN}/soak.html`),
  });
  await expectState(context, 'playing');
  const firstAudioMs = Date.now() - t0;

  const buffers: number[] = [];
  const deadline = Date.now() + MINUTES * 60_000;
  while (Date.now() < deadline) {
    await page.waitForTimeout(5000);
    const stats = (await report(await currentWorker(context))).stats.find(
      (s) => s.host === 'offscreen',
    );
    if (stats && stats.state === 'playing') buffers.push(stats.bufferAhead);
  }

  const s = await session(context);
  expect(s?.state).toBe('playing');
  // Stalls: the player passes through `buffering` at every segment boundary; a stall is one that
  // lasts. With prefetch ahead, the next segment is ready within a few milliseconds.
  const statuses = (await debugLog(context)).flatMap((e) =>
    e.kind === 'status' && e.host === 'offscreen' ? [{ state: e.status.state, at: e.at }] : [],
  );
  const start = statuses.findIndex((x) => x.state === 'playing');
  const waits: number[] = [];
  for (let i = start; i < statuses.length - 1; i++) {
    const cur = statuses[i];
    const next = statuses[i + 1];
    if (cur?.state === 'buffering' && next) waits.push(next.at - cur.at);
  }
  expect(statuses.slice(start).some((x) => x.state === 'error')).toBe(false);
  expect(waits.length).toBeGreaterThan(MINUTES * 5);
  expect(Math.max(...waits)).toBeLessThanOrEqual(250);
  const final = (await report(await currentWorker(context))).stats.find(
    (x) => x.host === 'offscreen',
  );
  expect(final).toMatchObject({ stalls: 0, errors: 0, fallbacks: 0, engineRestarts: 0 });
  // Buffer ahead (§9.1: ≥ 20 s), skipping the first sample while prefetch ramps up.
  expect(Math.min(...buffers.slice(1))).toBeGreaterThanOrEqual(20);
  // Highlight drift (§9.1: ≤ 50 ms).
  const [drift = 'NaN', samples = '0', settle = 'NaN'] = (
    (await page.evaluate(() => document.documentElement.dataset.orDrift)) ?? ''
  ).split('/');
  const drifts = ((await page.evaluate(() => document.documentElement.dataset.orDrifts)) ?? '')
    .split(',')
    .map(Number)
    .sort((x, y) => x - y);
  console.log(
    `drift p50 ${drifts[Math.floor(drifts.length * 0.5)]} p95 ${drifts[Math.floor(drifts.length * 0.95)]} p99 ${drifts[Math.floor(drifts.length * 0.99)]} top ${drifts.slice(-8).join(' ')}`,
  );
  expect(Number(samples)).toBeGreaterThan(MINUTES * 10);
  expect(Number(drift)).toBeLessThanOrEqual(50);
  console.log(
    `soak ${MINUTES} min: first audio ${firstAudioMs} ms, sentence ${s?.cursor.sentence}/${s?.sentenceCount}, ` +
      `min buffer ${Math.min(...buffers).toFixed(1)} s, max drift ${drift} ms over ${samples} samples (start-up settle ≤ ${settle} ms), longest boundary wait ${Math.max(...waits)} ms`,
  );
});
