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
