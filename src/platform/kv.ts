import { browser, type Browser } from 'wxt/browser';

/** Minimal key-value storage interface so UI and core code never touch chrome.* directly. */
export interface KeyValueStore {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  /** Calls `listener` when another context changes `key`. Returns an unsubscribe function. */
  watch<T>(key: string, listener: (value: T | undefined) => void): () => void;
}

export function memoryStore(initial: Record<string, unknown> = {}): KeyValueStore {
  const data = new Map<string, unknown>(Object.entries(initial));
  const listeners = new Map<string, Set<(v: unknown) => void>>();
  return {
    async get<T>(key: string) {
      return data.get(key) as T | undefined;
    },
    async set<T>(key: string, value: T) {
      data.set(key, value);
      listeners.get(key)?.forEach((l) => l(value));
    },
    watch<T>(key: string, listener: (value: T | undefined) => void) {
      const set = listeners.get(key) ?? new Set();
      set.add(listener as (v: unknown) => void);
      listeners.set(key, set);
      return () => set.delete(listener as (v: unknown) => void);
    },
  };
}

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
