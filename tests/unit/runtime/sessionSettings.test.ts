import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from '@/core/settings';
import type { InstalledIndex } from '@/core/models/manager';
import { sessionSettingsFrom } from '@/runtime/sessionSettings';

const installed = (...ids: string[]): InstalledIndex =>
  Object.fromEntries(
    ids.map((modelId) => [
      modelId,
      { modelId, version: '1', backend: 'any', files: [], installedAt: 0 },
    ]),
  );

describe('sessionSettingsFrom', () => {
  it('defaults to Kokoro Heart with a ladder down to Piper and system voices', () => {
    const s = sessionSettingsFrom(
      DEFAULT_SETTINGS,
      installed('kokoro-82m-v1-timestamped', 'piper-en_US-lessac-high'),
      false,
    );
    expect(s).toMatchObject({
      engineId: 'kokoro',
      voice: 'af_heart',
      cacheCapBytes: 512 * 1024 * 1024,
    });
    expect(s.fallbacks?.map((f) => `${f.engineId}${f.backend ? `:${f.backend}` : ''}`)).toEqual([
      'kokoro:wasm',
      'piper',
      'system',
    ]);
  });

  it('uses system voices with no download, and the test engine in test builds', () => {
    expect(sessionSettingsFrom(DEFAULT_SETTINGS, {}, false)).toMatchObject({
      engineId: 'system',
      fallbacks: [],
    });
    expect(sessionSettingsFrom(DEFAULT_SETTINGS, {}, true)).toMatchObject({
      engineId: 'test',
      cacheCapBytes: 512 * 1024 * 1024,
    });
  });
});
