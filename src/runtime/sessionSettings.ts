/** Turns stored settings into the settings a reading session runs with. */
import type { InstalledIndex } from '@/core/models/manager';
import type { Settings } from '@/core/settings';
import { fallbackLadder } from '@/core/tts/fallback';
import { DEFAULT_SESSION_SETTINGS, type SessionSettings } from './protocol';

/**
 * The chosen voice; else Kokoro if installed; else system voices (zero download, §6.5).
 * Test builds use the deterministic TestEngine unless a test chose a voice.
 */
export function sessionSettingsFrom(
  s: Settings,
  installed: InstalledIndex,
  test: boolean,
): SessionSettings {
  let voice = s.voice;
  if (!voice && !test) {
    const kokoro = Object.values(installed).find((m) => m.modelId.startsWith('kokoro'));
    voice = kokoro
      ? { engineId: 'kokoro', modelId: kokoro.modelId, voice: 'af_heart' }
      : { engineId: 'system', voice: '' };
  }
  const cacheCapBytes = s.cacheCapMB * 1024 * 1024;
  if (!voice)
    return {
      ...DEFAULT_SESSION_SETTINGS,
      rate: s.rate,
      pacing: s.pacing,
      skipRules: s.skipRules,
      cacheCapBytes,
    };
  const models = Object.values(installed).map((m) => ({
    engineId: m.modelId.split('-')[0] ?? '',
    modelId: m.modelId,
  }));
  return {
    rate: s.rate,
    pacing: s.pacing,
    engineId: voice.engineId,
    modelId: voice.modelId,
    backend: voice.backend,
    voice: voice.voice,
    skipRules: s.skipRules,
    cacheCapBytes,
    fallbacks: fallbackLadder(voice, models, { system: !test }),
  };
}
