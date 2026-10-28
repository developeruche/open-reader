// Copies runtime assets the spike extension loads from its own origin (gitignored copies).
import { cpSync, mkdirSync } from 'node:fs';

const S = 'spikes/extension/public';
const HEADTTS = process.env.HEADTTS_DIR; // a checkout of met4citizen/HeadTTS@5ae6d5e
for (const d of ['ort', 'piper', 'pdfjs', 'headtts']) mkdirSync(`${S}/${d}`, { recursive: true });
for (const f of ['ort-wasm-simd-threaded.asyncify', 'ort-wasm-simd-threaded.jsep', 'ort-wasm-simd-threaded'])
  for (const ext of ['mjs', 'wasm']) cpSync(`node_modules/onnxruntime-web/dist/${f}.${ext}`, `${S}/ort/${f}.${ext}`);
cpSync('node_modules/@diffusionstudio/piper-wasm/build', `${S}/piper`, { recursive: true });
cpSync('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', `${S}/pdfjs/pdf.worker.min.mjs`);
for (const d of ['wasm', 'standard_fonts', 'cmaps']) cpSync(`node_modules/pdfjs-dist/${d}`, `${S}/pdfjs/${d}`, { recursive: true });
if (HEADTTS) cpSync(`${HEADTTS}/dictionaries/en-us.txt`, `${S}/headtts/en-us.txt`);
console.log('spike assets copied');
