import { existsSync, readFileSync } from 'node:fs';
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
];

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
export default defineConfig({
  srcDir: 'src',
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
      for (const [src, dest] of [...RUNTIME_ASSETS, ...offlineModels()])
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
        description: 'Open Open Reader',
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
    web_accessible_resources: [],
    // Exposed to tests so they can tell a test build apart.
    ...(mode === 'test' ? { short_name: 'Open Reader (test)' } : {}),
  }),
});
