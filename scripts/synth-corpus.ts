/**
 * Renders the bake-off passages with every voice in headless Chromium (PLAN.md §11, M7).
 *   pnpm build:test && pnpm models:fetch all && pnpm synth:corpus [--quick]
 * Writes quality/out/<run>/{*.wav, manifest.json, report.json, report.md}. Then:
 *   uv run --project quality python quality/asr_qa.py quality/out/<run>
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { chromium, type Page } from '@playwright/test';
import { padEnd } from '../src/core/audio/dsp';
import { postProcess } from '../src/core/audio/process';
import { encodeWav } from '../src/core/audio/wav';
import { Lexicon } from '../src/core/text/lexicon';
import { normalize } from '../src/core/text/normalize';
import { segmentSentences } from '../src/core/text/segment';
import passages from '../tests/fixtures/corpus/passages.json';
import { startModelServer } from '../tests/models/model-server';
import { corpus } from './corpus';

interface Voice {
  engineId: 'kokoro' | 'piper';
  modelId: string;
  voice: string;
  label: string;
}

const KOKORO = 'kokoro-82m-v1-timestamped';
const VOICES: Voice[] = [
  { engineId: 'kokoro', modelId: KOKORO, voice: 'af_heart', label: 'Kokoro Heart' },
  { engineId: 'kokoro', modelId: KOKORO, voice: 'am_michael', label: 'Kokoro Michael' },
  { engineId: 'kokoro', modelId: KOKORO, voice: 'bf_emma', label: 'Kokoro Emma' },
  { engineId: 'kokoro', modelId: KOKORO, voice: 'bm_george', label: 'Kokoro George' },
  {
    engineId: 'piper',
    modelId: 'piper-en_US-lessac-high',
    voice: 'en_US-lessac-high',
    label: 'Piper Classic (lessac high)',
  },
  {
    engineId: 'piper',
    modelId: 'piper-en_US-lessac-medium',
    voice: 'en_US-lessac-medium',
    label: 'Piper lessac medium',
  },
  {
    engineId: 'piper',
    modelId: 'piper-en_US-ljspeech-high',
    voice: 'en_US-ljspeech-high',
    label: 'Piper LJSpeech high',
  },
];

const quick = process.argv.includes('--quick');
const run = new Date().toISOString().replace(/[:.]/g, '-');
const out = path.resolve('quality/out', run);
mkdirSync(out, { recursive: true });

const call = <R>(page: Page, fn: string, ...args: unknown[]) =>
  page.evaluate(
    ([f, a]) => {
      const hooks = (
        window as unknown as { __models: Record<string, (...x: unknown[]) => Promise<unknown>> }
      ).__models;
      const hook = hooks[f as string];
      if (!hook) throw new Error(`no test hook ${String(f)}`);
      return hook(...(a as unknown[])) as Promise<R>;
    },
    [fn, args] as const,
  ) as Promise<R>;

async function main() {
  const server = await startModelServer(8767);
  const ext = path.resolve('output/chrome-mv3-test');
  const profile = mkdtempSync(path.join(tmpdir(), 'or-bake-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
  });
  const sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent('serviceworker'));
  const page = await ctx.newPage();
  await page.goto(`chrome-extension://${sw.url().split('/')[2]}/options.html`);
  await page.waitForFunction(() => (window as { __models?: unknown }).__models !== undefined);
  const gpu = await page.evaluate(
    async () =>
      !!(await (
        navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }
      ).gpu?.requestAdapter()),
  );
  const backend = gpu ? 'webgpu' : 'wasm';
  for (const id of new Set(VOICES.map((v) => v.modelId)))
    await call(page, 'install', id, backend, server.base);

  const manifest: unknown[] = [];
  const report: Record<string, unknown>[] = [];
  const list = quick ? passages.passages.slice(0, 3) : passages.passages;
  for (const v of VOICES) {
    const lexicon = new Lexicon({ engineId: v.engineId });
    let synth = 0;
    let audio = 0;
    let firstMs = 0;
    for (const [pi, p] of list.entries()) {
      const spoken = segmentSentences(p.text).map(
        (s) => normalize(p.text.slice(s.start, s.end), { lexicon }).spoken,
      );
      const rendered = await call<
        { ms: number; sampleRate: number; pcm: number[]; words: unknown }[]
      >(page, 'synthRaw', { engineId: v.engineId, modelId: v.modelId, backend }, v.voice, spoken);
      if (pi === 0) firstMs = rendered[0]?.ms ?? 0;
      const sr = rendered[0]?.sampleRate ?? 24000;
      const parts = rendered.map(
        (r) => postProcess(Float32Array.from(r.pcm), r.sampleRate, [], { pauseAfter: 0.22 }).pcm,
      );
      synth += rendered.reduce((a, r) => a + r.ms / 1000, 0);
      audio += rendered.reduce((a, r) => a + r.pcm.length / r.sampleRate, 0);
      const joined = padEnd(Float32Array.from(parts.flatMap((x) => Array.from(x))), sr, 0.3);
      const file = `${v.voice}__${p.id}.wav`;
      writeFileSync(path.join(out, file), encodeWav(joined, sr));
      manifest.push({
        id: p.id,
        engine: v.engineId,
        voice: v.voice,
        label: v.label,
        spoken: spoken.join(' '),
        display: p.text,
        wav: file,
      });
    }
    report.push({
      label: v.label,
      engine: v.engineId,
      voice: v.voice,
      backend,
      rtf: +(synth / audio).toFixed(3),
      firstAudioMs: Math.round(firstMs),
    });
    console.log(
      `${v.label}: RTF ${(synth / audio).toFixed(3)}, first audio ${Math.round(firstMs)} ms`,
    );
  }
  const sentences = quick ? corpus(40) : corpus(200);
  const est = await call<{ sentences: number; meanMs: number; p90Ms: number }>(
    page,
    'estimateError',
    { engineId: 'kokoro', modelId: KOKORO, backend },
    'af_heart',
    sentences,
  );
  console.log(
    `Estimated vs native timings (Kokoro audio, ${est.sentences} sentences): mean ${est.meanMs.toFixed(0)} ms, p90 ${est.p90Ms.toFixed(0)} ms`,
  );
  writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));
  writeFileSync(
    path.join(out, 'report.json'),
    JSON.stringify({ run, backend, voices: report, estimateError: est }, null, 2),
  );
  const md = [
    `# Bake-off ${run}`,
    '',
    `Backend: ${backend}. Passages: ${list.length}.`,
    '',
    '| Voice | RTF | First audio (ms) |',
    '|---|---|---|',
    ...report.map((r) => `| ${String(r.label)} | ${String(r.rtf)} | ${String(r.firstAudioMs)} |`),
    '',
    `Timing estimation error vs Kokoro native: mean ${est.meanMs.toFixed(0)} ms, p90 ${est.p90Ms.toFixed(0)} ms over ${est.sentences} sentences (target ≤ 120 ms).`,
  ].join('\n');
  writeFileSync(path.join(out, 'report.md'), md + '\n');
  writeFileSync(
    path.join(out, 'index.html'),
    listeningPage(run, manifest as ManifestRow[], report),
  );
  console.log(`\nWrote ${out}`);
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
  server.close();
}

interface ManifestRow {
  id: string;
  voice: string;
  label: string;
  display: string;
  wav: string;
}

/** A local page to compare voices passage by passage (opened from disk; no network). */
function listeningPage(
  run: string,
  rows: ManifestRow[],
  report: Record<string, unknown>[],
): string {
  const esc = (t: string) =>
    t.replace(
      /[&<>"]/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c,
    );
  const ids = [...new Set(rows.map((r) => r.id))];
  const voices = [...new Set(rows.map((r) => r.label))];
  const perf = new Map(
    report.map((r) => [
      String(r.label),
      `RTF ${String(r.rtf)}, first audio ${String(r.firstAudioMs)} ms`,
    ]),
  );
  const sections = ids
    .map((id) => {
      const items = rows.filter((r) => r.id === id);
      return `<section><h2>${esc(id)}</h2><p class="t">${esc(items[0]?.display ?? '')}</p>${items
        .map(
          (r) =>
            `<div class="row"><span>${esc(r.label)}</span><audio controls preload="none" src="${esc(r.wav)}"></audio></div>`,
        )
        .join('')}</section>`;
    })
    .join('');
  return `<!doctype html><html lang="en"><meta charset="utf-8"><title>Open Reader voice bake-off</title>
<style>body{font:15px/1.5 ui-sans-serif,system-ui;background:#f6f4ef;color:#0b0b0b;max-width:860px;margin:40px auto;padding:0 16px}h1{font:500 28px Georgia,serif}h2{font:500 18px Georgia,serif;margin-top:32px}.t{color:#2b2a28}.row{display:flex;align-items:center;gap:12px;border-top:1px solid #e1ddd4;padding:6px 0}.row span{width:240px}audio{flex:1}table{border-collapse:collapse}td,th{border-bottom:1px solid #e1ddd4;padding:4px 12px 4px 0;text-align:left}</style>
<h1>Voice bake-off</h1><p>Run ${esc(run)}. Same text, same processing (trim, −20 dBFS loudness, 0.22 s between sentences).</p>
<table><tr><th>Voice</th><th>Speed on this machine</th></tr>${voices.map((v) => `<tr><td>${esc(v)}</td><td>${esc(perf.get(v) ?? '')}</td></tr>`).join('')}</table>
${sections}</html>`;
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
