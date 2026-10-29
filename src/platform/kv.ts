import { browser, type Browser } from 'wxt/browser';

import { memoryStore, type KeyValueStore } from '@/core/util/kv';

export { memoryStore, type KeyValueStore };

/** chrome.storage.local, falling back to memory outside an extension context (tests, Storybook-like pages). */
export function localStore(): KeyValueStore {
  const area = (browser as typeof browser | undefined)?.storage?.local;
  if (!area) return memoryStore();
  return {
    async get<T>(key: string) {
      const r = await area.get(key);
      return r[key] as T | undefined;
    },
    async set<T>(key: string, value: T) {
      await area.set({ [key]: value });
    },
    watch<T>(key: string, listener: (value: T | undefined) => void) {
      const onChanged = (changes: Record<string, Browser.storage.StorageChange>, name: string) => {
        if (name === 'local' && key in changes) listener(changes[key]?.newValue as T | undefined);
      };
      browser.storage.onChanged.addListener(onChanged);
      return () => browser.storage.onChanged.removeListener(onChanged);
    },
  };
}
