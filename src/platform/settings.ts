/** Settings in chrome.storage.local (never synced). */
import { DEFAULT_SETTINGS, migrateSettings, SETTINGS_KEY, type Settings } from '@/core/settings';
import { localStore } from './kv';

const kv = localStore();

export async function loadSettings(): Promise<Settings> {
  return migrateSettings(await kv.get(SETTINGS_KEY));
}

export async function saveSettings(patch: Partial<Settings>): Promise<Settings> {
  const next = migrateSettings({ ...(await loadSettings()), ...patch });
  await kv.set(SETTINGS_KEY, next);
  return next;
}

export function watchSettings(listener: (s: Settings) => void): () => void {
  return kv.watch(SETTINGS_KEY, (v) => listener(migrateSettings(v)));
}

export { DEFAULT_SETTINGS };
