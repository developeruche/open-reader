import { defineConfig } from 'wxt';

export default defineConfig({
  srcDir: '.',
  manifest: {
    ...(process.env.SPIKE_COI ? { cross_origin_embedder_policy: { value: 'require-corp' }, cross_origin_opener_policy: { value: 'same-origin' } } : {}),
    name: 'Open Reader spikes',
    permissions: ['offscreen', 'storage', 'unlimitedStorage', 'scripting', 'tabs'],
    host_permissions: ['<all_urls>'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    },
  },
});
