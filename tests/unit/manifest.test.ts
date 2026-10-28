import { describe, expect, it } from 'vitest';
import config from '../../wxt.config';

type ManifestFn = (env: { mode: string }) => Record<string, unknown>;

describe('manifest', () => {
  const manifest = (config.manifest as ManifestFn)({ mode: 'production' });

  it('uses a strict CSP with no remote code', () => {
    expect(manifest.content_security_policy).toEqual({
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';",
    });
  });

  it('declares at most four suggested shortcut keys', () => {
    expect(Object.keys(manifest.commands as object)).toHaveLength(4);
  });
});
