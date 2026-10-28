import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  srcDir: 'src',
  modules: ['@wxt-dev/module-react'],
  vite: () => ({
    plugins: [tailwindcss()],
  }),
  hooks: {
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
