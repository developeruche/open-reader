/**
 * Chrome Web Store promo tiles, drawn in the extension's own fonts and colors:
 *   pnpm promo-tiles
 * Writes docs/store/promo-small-440x280.png and docs/store/promo-marquee-1400x560.png. The
 * marquee uses docs/images/web.png, so run `pnpm screenshots` first if the UI changed.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const OUT = path.resolve('docs/store');
const b64 = (p: string) => readFileSync(path.resolve(p)).toString('base64');
const font = (family: string, file: string) =>
  `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${b64(file)}) format('woff2');font-weight:100 900}`;

const CSS = `
${font('Newsreader', 'node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2')}
${font('Geist', 'node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2')}
* { box-sizing: border-box; margin: 0; }
body { background: #f6f4ef; color: #0b0b0b; font-family: Geist, sans-serif; overflow: hidden; }
h1 { font-family: Newsreader, serif; font-weight: 600; letter-spacing: -0.015em; line-height: 1.05; }
.word { background: #0b0b0b; color: #f6f4ef; border-radius: 3px; padding: 0 0.14em; }
.sentence { background: rgba(11, 11, 11, 0.08); border-radius: 3px; }
.muted { color: #55524b; }
`;

const ICON = `<img src="data:image/png;base64,${b64('public/icon/128.png')}" alt="">`;

const SMALL = `
<body style="width:440px;height:280px;padding:34px 36px;display:flex;flex-direction:column;justify-content:space-between">
  <div style="display:flex;align-items:center;gap:14px">
    <div style="width:52px;height:52px">${ICON.replace('<img', '<img width="52" height="52"')}</div>
    <h1 style="font-size:34px">Open Reader</h1>
  </div>
  <p style="font-family:Newsreader,serif;font-size:25px;line-height:1.3">
    <span class="sentence">Listen to any article or PDF, <span class="word">word</span> by word.</span>
  </p>
  <p class="muted" style="font-size:15px;font-weight:500">Natural voices · Private · Works offline</p>
</body>`;

const MARQUEE = `
<body style="width:1400px;height:560px;display:flex;align-items:center;padding:0 48px 0 80px;gap:52px">
  <div style="width:500px;flex:none">
    <div style="display:flex;align-items:center;gap:16px;margin-bottom:34px">
      ${ICON.replace('<img', '<img width="56" height="56"')}
      <span style="font-size:24px;font-weight:600;letter-spacing:-0.01em">Open Reader</span>
    </div>
    <h1 style="font-size:56px">
      <span class="sentence">Listen to what you read, <span class="word">word</span> by word.</span>
    </h1>
    <p class="muted" style="font-size:21px;line-height:1.5;margin-top:26px">
      Natural voices that run on your computer, for articles and PDFs. Private, free and offline.
    </p>
  </div>
  <div style="flex:none;width:720px;height:450px;border-radius:12px;overflow:hidden;
              box-shadow:0 2px 6px rgba(11,11,11,.08),0 24px 60px rgba(11,11,11,.16);
              border:1px solid #dedad1">
    <img src="data:image/png;base64,${b64('docs/images/web.png')}" style="width:720px;display:block" alt="">
  </div>
</body>`;

async function main() {
  const browser = await chromium.launch({ channel: 'chromium' });
  for (const [name, html, width, height] of [
    ['promo-small-440x280.png', SMALL, 440, 280],
    ['promo-marquee-1400x560.png', MARQUEE, 1400, 560],
  ] as const) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><style>${CSS}</style>${html}`);
    await page.evaluate(() => document.fonts.ready);
    // The store wants 24-bit images: JPEG would blur the text, so PNG on an opaque background.
    await page.screenshot({ path: path.join(OUT, name), omitBackground: false });
    await page.close();
  }
  await browser.close();
  console.log(`wrote ${OUT}/promo-small-440x280.png and promo-marquee-1400x560.png`);
}

void main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
