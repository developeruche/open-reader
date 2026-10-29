/**
 * Performance budgets checked in CI (PLAN.md §9.1, M10): gzipped JavaScript each page loads up
 * front, from the built extension. Engines, PDF.js workers and WASM load lazily and are excluded.
 *
 *   pnpm build && pnpm budgets [.output/chrome-mv3]
 */
import { readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const dir = path.resolve(process.argv[2] ?? '.output/chrome-mv3');
const KB = 1024;

interface Budget {
  name: string;
  /** HTML page whose module scripts and modulepreloads count, or a single script. */
  entry: string;
  maxGzip: number;
}

const BUDGETS: Budget[] = [
  { name: 'Side panel JS (excluding engines)', entry: 'sidepanel.html', maxGzip: 300 * KB },
  { name: 'Options JS', entry: 'options.html', maxGzip: 300 * KB },
  { name: 'Background service worker', entry: 'background.js', maxGzip: 120 * KB },
  {
    name: 'Content script (injected on demand)',
    entry: 'content-scripts/content.js',
    maxGzip: 250 * KB,
  },
  // PDF.js's viewer is bundled into the reader; its worker loads separately.
  { name: 'Reader page JS', entry: 'reader.html', maxGzip: 450 * KB },
];

function scriptsOf(entry: string): string[] {
  if (!entry.endsWith('.html')) return [entry];
  const html = readFileSync(path.join(dir, entry), 'utf8');
  const out = new Set<string>();
  for (const m of html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g))
    out.add(m[1] ?? '');
  for (const m of html.matchAll(/<link[^>]*rel="modulepreload"[^>]*href="([^"]+)"/g))
    out.add(m[1] ?? '');
  return [...out].filter(Boolean).map((s) => s.replace(/^\//, ''));
}

const gz = (file: string) => gzipSync(readFileSync(path.join(dir, file)), { level: 9 }).byteLength;

let failed = false;
const rows: string[][] = [];
for (const b of BUDGETS) {
  const files = scriptsOf(b.entry);
  const raw = files.reduce((a, f) => a + statSync(path.join(dir, f)).size, 0);
  const zipped = files.reduce((a, f) => a + gz(f), 0);
  const ok = zipped <= b.maxGzip;
  failed ||= !ok;
  rows.push([
    ok ? 'ok  ' : 'FAIL',
    b.name,
    `${(zipped / KB).toFixed(1)} KB gz`,
    `(${(raw / KB).toFixed(0)} KB raw, budget ${(b.maxGzip / KB).toFixed(0)} KB)`,
  ]);
}
const widths = rows[0]?.map((_, i) => Math.max(...rows.map((r) => r[i]?.length ?? 0))) ?? [];
for (const r of rows) console.log(r.map((c, i) => c.padEnd(widths[i] ?? 0)).join('  '));
if (failed) {
  console.error('\nA performance budget was exceeded (PLAN.md §9.1).');
  process.exit(1);
}
