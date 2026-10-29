/**
 * Generates PDF fixtures with known reading orders (PLAN.md §11):
 *   pnpm fixtures   → tests/fixtures/pdf/*.pdf and *.golden.json
 * Each golden lists the readable blocks in order and the text that must be skipped.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { chromium } from '@playwright/test';
import { PDFDocument, rgb, StandardFonts, type PDFFont, type PDFPage } from 'pdf-lib';

const OUT = 'tests/fixtures/pdf';
const W = 612;
const H = 792;

interface Golden {
  /** Readable block texts in reading order. */
  blocks: string[];
  /** Text that must not be read (headers, footers, page numbers, references). */
  skipped: string[];
  /** Words to probe: [page, text]. */
  probes?: [number, string][];
}

/** Breaks text into lines that fit `width` at `size`. */
function wrap(text: string, font: PDFFont, size: number, width: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    const next = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(next, size) > width && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

function paragraph(
  page: PDFPage,
  text: string,
  x: number,
  y: number,
  width: number,
  font: PDFFont,
  size = 11,
  leading = 15,
): number {
  for (const l of wrap(text, font, size, width)) {
    page.drawText(l, { x, y, size, font });
    y -= leading;
  }
  return y - leading * 0.6;
}

const PARAS = [
  'A partially signed transaction is a container for a transaction that is not finished yet. Each wallet that touches it adds what it knows, and nobody has to trust anybody else with private keys.',
  'The creator proposes the inputs and outputs. The updater adds previous outputs, scripts and derivation paths so that signers can check what they are about to approve.',
  'A hardware wallet can show the real fee before it signs, because the container carries the full previous outputs. That closed an attack in which a malicious computer lied about the amounts.',
  'Taproot lets a wallet hide unused spending conditions behind a single public key. When everyone agrees, the coins move with one signature and the script is never revealed.',
  'Fees are a market. Every block has limited room, and miners pick the transactions that pay the most for the space they use.',
  'Running your own node remains the best way to verify the rules yourself. It works on a small computer and needs no permission from anyone.',
];
const para = (i: number): string => PARAS[i % PARAS.length] ?? '';

async function singleColumn(): Promise<Golden> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const blocks: string[] = [];
  const page = doc.addPage([W, H]);
  page.drawText('Reading a partially signed transaction', { x: 72, y: 700, size: 20, font: bold });
  blocks.push('Reading a partially signed transaction');
  let y = 660;
  for (const [i, p] of PARAS.slice(0, 3).entries()) {
    if (i === 1) {
      page.drawText('The roles', { x: 72, y, size: 15, font: bold });
      blocks.push('The roles');
      y -= 26;
    }
    y = paragraph(page, p, 72, y, 468, font);
    blocks.push(p);
  }
  writeFileSync(`${OUT}/single-column.pdf`, await doc.save());
  return { blocks, skipped: [] };
}

async function twoColumns(): Promise<Golden> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const blocks: string[] = [];
  const colW = 225;
  for (let p = 1; p <= 2; p++) {
    const page = doc.addPage([W, H]);
    page.drawText('Spike Journal of Reading Order, Volume 3', { x: 72, y: 750, size: 9, font });
    page.drawText(String(p), { x: 300, y: 36, size: 9, font });
    let top = 700;
    if (p === 1) {
      page.drawText('Two columns, one voice', { x: 72, y: 700, size: 20, font: bold });
      blocks.push('Two columns, one voice');
      top = 660;
    }
    const left = p === 1 ? PARAS.slice(0, 2) : PARAS.slice(3, 4);
    const right =
      p === 1
        ? PARAS.slice(2, 3)
        : [
            'Only on the second page does the zebra appear in the right column, far from the left.',
            para(4),
          ];
    let y = top;
    for (const t of left) {
      y = paragraph(page, t, 72, y, colW, font);
      blocks.push(t);
    }
    y = top;
    for (const t of right) {
      y = paragraph(page, t, 72 + colW + 42, y, colW, font);
      blocks.push(t);
    }
  }
  writeFileSync(`${OUT}/two-column.pdf`, await doc.save());
  return {
    blocks,
    skipped: ['Spike Journal of Reading Order, Volume 3', '1', '2'],
    probes: [[2, 'zebra']],
  };
}

async function headersFooters(): Promise<Golden> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const blocks: string[] = [];
  for (let p = 1; p <= 5; p++) {
    const page = doc.addPage([W, H]);
    page.drawText(`Field notes on fees — chapter ${p}`, { x: 72, y: 760, size: 8, font });
    page.drawText(`Page ${p} of 5`, { x: 270, y: 30, size: 8, font });
    const t = para(p - 1);
    paragraph(page, t, 72, 680, 468, font, 11);
    blocks.push(t);
  }
  writeFileSync(`${OUT}/headers-footers.pdf`, await doc.save());
  return { blocks, skipped: ['Field notes on fees', 'Page 1 of 5', 'Page 5 of 5'] };
}

async function hyphenation(): Promise<Golden> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const page = doc.addPage([W, H]);
  const lines = [
    'The signer checks every amount and the sig-',
    'nature covers all inputs before the trans-',
    'action is broadcast to the whole network.',
  ];
  let y = 700;
  for (const l of lines) {
    page.drawText(l, { x: 72, y, size: 12, font });
    y -= 16;
  }
  writeFileSync(`${OUT}/hyphenation.pdf`, await doc.save());
  return {
    blocks: [
      'The signer checks every amount and the signature covers all inputs before the transaction is broadcast to the whole network.',
    ],
    skipped: [],
  };
}

async function references(): Promise<Golden> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const page = doc.addPage([W, H]);
  let y = 700;
  y = paragraph(page, para(0), 72, y, 468, font);
  page.drawText('Figure 1. The roles of a signing session.', { x: 72, y, size: 9, font });
  y -= 30;
  page.drawText('References', { x: 72, y, size: 15, font: bold });
  y -= 24;
  for (const r of [
    '[1] A. Chow. Partially signed transaction format. 2017.',
    '[2] Wallet survey. 2020.',
  ]) {
    page.drawText(r, { x: 72, y, size: 10, font });
    y -= 14;
  }
  writeFileSync(`${OUT}/references.pdf`, await doc.save());
  return {
    blocks: [para(0), 'Figure 1. The roles of a signing session.', 'References'],
    skipped: ['A. Chow', 'Wallet survey'],
  };
}

async function imageOnly(): Promise<Golden> {
  const doc = await PDFDocument.create();
  const page = doc.addPage([W, H]);
  // Drawn shapes only: no text items on this page (OCR fixture for M13).
  for (let i = 0; i < 12; i++)
    page.drawRectangle({
      x: 72,
      y: 700 - i * 20,
      width: 300 + (i % 3) * 40,
      height: 8,
      color: rgb(0.1, 0.1, 0.1),
    });
  writeFileSync(`${OUT}/image-only.pdf`, await doc.save());
  return { blocks: [], skipped: [] };
}

export const SCANNED_TEXT = [
  'Signing with a hardware wallet',
  'A partially signed transaction travels between wallets until every signer has added what it knows.',
  'The hardware wallet shows the destination and the fee before it signs anything at all.',
];

/** A scanned page (M13): text rendered by Chromium and embedded as an image, no text items. */
async function scanned(): Promise<Golden> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: W, height: H },
      deviceScaleFactor: 2.5,
    });
    const [title, ...paras] = SCANNED_TEXT;
    await page.setContent(`<!doctype html><body style="margin:72px;font:15px/1.5 Georgia,serif;color:#222;background:#fbfaf7">
      <h1 style="font-size:24px;margin:0 0 18px">${title}</h1>${paras.map((t) => `<p style="margin:0 0 14px">${t}</p>`).join('')}</body>`);
    const png = await page.screenshot({ type: 'png' });
    const doc = await PDFDocument.create();
    const p = doc.addPage([W, H]);
    p.drawImage(await doc.embedPng(png), { x: 0, y: 0, width: W, height: H });
    writeFileSync(`${OUT}/scanned.pdf`, await doc.save());
  } finally {
    await browser.close();
  }
  return { blocks: SCANNED_TEXT, skipped: [] };
}

/** A 100-page document for the performance check (§9.1). */
async function hundredPages(): Promise<void> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  for (let p = 1; p <= 100; p++) {
    const page = doc.addPage([W, H]);
    page.drawText(`Long report — page ${p}`, { x: 72, y: 760, size: 8, font });
    let y = 700;
    for (let k = 0; k < 6; k++) y = paragraph(page, para(p + k), 72, y, 468, font, 11);
    page.drawText(String(p), { x: 300, y: 30, size: 8, font });
  }
  writeFileSync(`${OUT}/hundred-pages.pdf`, await doc.save());
}

async function main() {
  mkdirSync(OUT, { recursive: true });
  const goldens: Record<string, Golden> = {
    'single-column': await singleColumn(),
    'two-column': await twoColumns(),
    'headers-footers': await headersFooters(),
    hyphenation: await hyphenation(),
    references: await references(),
    'image-only': await imageOnly(),
    scanned: await scanned(),
  };
  await hundredPages();
  for (const [name, g] of Object.entries(goldens))
    writeFileSync(`${OUT}/${name}.golden.json`, JSON.stringify(g, null, 2) + '\n');
  console.log(`wrote ${Object.keys(goldens).length + 1} PDFs to ${OUT}`);
}

void main();
