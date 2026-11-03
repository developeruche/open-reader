import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

/** Runtime assets copied into the build (every JS/WASM file is bundled; MV3 forbids remote code). */
const RUNTIME_ASSETS: [src: string, dest: string][] = [
  [
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs',
    'ort/ort-wasm-simd-threaded.asyncify.mjs',
  ],
  [
    'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm',
    'ort/ort-wasm-simd-threaded.asyncify.wasm',
  ],
  ['assets/g2p/en-us.txt', 'g2p/en-us.txt'],
  [
    'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm',
    'piper/piper_phonemize.wasm',
  ],
  [
    'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data',
    'piper/piper_phonemize.data',
  ],
  // OCR (§8.5, ADR 0020): tesseract.js worker, the SIMD LSTM core, and English best_int data.
  ['node_modules/tesseract.js/dist/worker.min.js', 'tesseract/worker.min.js'],
  [
    'node_modules/tesseract.js-core/tesseract-core-simd-lstm.wasm.js',
    'tesseract/tesseract-core-simd-lstm.wasm.js',
  ],
  [
    'node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz',
    'tesseract/lang/eng.traineddata.gz',
  ],
];

/** PDF.js worker, WASM image decoders, standard fonts and cMaps (§8.2), all local. */
function pdfAssets(): [string, string][] {
  const out: [string, string][] = [
    ['node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'pdfjs/pdf.worker.min.mjs'],
  ];
  for (const dir of ['wasm', 'standard_fonts', 'cmaps']) {
    const root = path.join('node_modules/pdfjs-dist', dir);
    for (const name of readdirSync(root))
      if (statSync(path.join(root, name)).isFile())
        out.push([path.join(root, name), `pdfjs/${dir}/${name}`]);
  }
  return out;
}

/**
 * `pnpm build:offline` bundles the default model (from `pnpm models:fetch`, models/cache) at
 * /models/<id>/<version>/<path>, where the model manager installs it from without any network.
 */
function offlineModels(): [string, string][] {
  if (process.env.OPEN_READER_OFFLINE !== '1') return [];
  const registry = JSON.parse(readFileSync('models/registry.json', 'utf8')) as {
    models: { id: string; engine: string; version: string; files: { path: string }[] }[];
  };
  const out: [string, string][] = [];
  for (const m of registry.models.filter((x) => x.engine === 'kokoro')) {
    for (const f of m.files) {
      const src = path.join('models/cache', m.engine, f.path);
      if (!existsSync(src)) throw new Error(`Missing ${src}: run pnpm models:fetch first`);
      out.push([src, `models/${m.id}/${m.version}/${f.path}`]);
    }
  }
  return out;
}

// See https://wxt.dev/api/config.html
const KEY =
  'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqc6i3OvaimtolxtBxF6l2sAg/OuEN8GdP/SrcX10cFSqbHszbAteNFqsPB65qjrdUYw1sEr25F8EuJMzcfwdusz9LE+lY1DkEoLaAeEvaCT9vYo2cROD0OaJhuflZkcjYlb45HjdqQk1tU0AF1N7Rn09S8+5kuZBoqtdgbBZR87u/Ex1RAHcJ87ASTliwcZ029cDZkZ8TeyZzdlgGQMondPafPcb+PZIi4za2wtsyj5EBK6+vbSyWde90mmbonW9w32Jjk3GtOsgZSBNOO05YG3amJIB3csrd/mgXSAJwduzUshbRxUx/nJii8y6uhAjDIhwnbALZeWXfT+kshLWQwIDAQAB';

export default defineConfig({
  srcDir: 'src',
  outDir: 'output',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
    // onnxruntime-web's "extern wasm" build loads its WASM from env.wasm.wasmPaths (/ort/, copied
    // below) instead of emitting a second 28 MB copy through import.meta.url.
    // Vite's default client conditions plus ORT's.
    resolve: {
      conditions: [
        'module',
        'browser',
        'development|production',
        'onnxruntime-web-use-extern-wasm',
      ],
    },
  }),
  hooks: {
    'build:publicAssets': (_wxt, files) => {
      for (const [src, dest] of [...RUNTIME_ASSETS, ...pdfAssets(), ...offlineModels()])
        files.push({ absoluteSrc: path.resolve(src), relativeDest: dest });
    },
    // The component gallery is a test fixture; keep it out of production builds.
    'entrypoints:resolved': (wxt, entrypoints) => {
      if (wxt.config.mode !== 'production') return;
      const i = entrypoints.findIndex((e) => e.name === 'gallery');
      if (i >= 0) entrypoints.splice(i, 1);
    },
  },
  manifest: ({ mode }) => ({
    name: 'Open Reader',
    // A fixed public key gives the unpacked extension the same ID (ciacahokbkkhcpoefghbmnmilbaalcem)
    // from any folder, so rebuilds and moves keep their downloaded voices and settings. Only the
    // public half is needed to load unpacked; there is no private key to protect. The Chrome Web
    // Store assigns its own ID and rejects a manifest with a key, so `pnpm zip:store` leaves it out.
    ...(process.env.WXT_OPEN_READER_STORE === '1' ? {} : { key: KEY }),
    description: 'Offline, reliable read-aloud for web pages and PDFs.',
    minimum_chrome_version: '116',
    permissions: [
      'sidePanel',
      'offscreen',
      'storage',
      'unlimitedStorage',
      'scripting',
      'activeTab',
      'contextMenus',
      'tts',
      'downloads',
      'declarativeNetRequestWithHostAccess',
    ],
    host_permissions: ['<all_urls>'],
    action: { default_title: 'Open Reader' },
    side_panel: { default_path: 'sidepanel.html' },
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
    commands: {
      _execute_action: {
        suggested_key: { default: 'Alt+Shift+O' },
        description: 'Open the side panel',
      },
      'toggle-play': {
        suggested_key: { default: 'Alt+Shift+P' },
        description: 'Play or pause',
      },
      'next-sentence': {
        suggested_key: { default: 'Alt+Shift+Period' },
        description: 'Next sentence',
      },
      'prev-sentence': {
        suggested_key: { default: 'Alt+Shift+Comma' },
        description: 'Previous sentence',
      },
    },
    // reader.html is reachable from pages only so the optional PDF redirect can land on it.
    web_accessible_resources: [{ resources: ['reader.html'], matches: ['<all_urls>'] }],
    // Exposed to tests so they can tell a test build apart.
    ...(mode === 'test' ? { short_name: 'Open Reader (test)' } : {}),
  }),
});
