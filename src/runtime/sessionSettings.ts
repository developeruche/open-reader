/** Turns stored settings into the settings a reading session runs with. */
import type { InstalledIndex } from '@/core/models/manager';
import type { Settings } from '@/core/settings';
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
  if (!voice)
    return { ...DEFAULT_SESSION_SETTINGS, rate: s.rate, pacing: s.pacing, skipRules: s.skipRules };
  return {
    rate: s.rate,
    pacing: s.pacing,
    engineId: voice.engineId,
    modelId: voice.modelId,
    backend: voice.backend,
    voice: voice.voice,
    skipRules: s.skipRules,
  };
}
