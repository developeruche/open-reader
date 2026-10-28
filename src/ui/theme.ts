import { create } from 'zustand';
import type { KeyValueStore } from '@/platform/kv';

export type ThemePreference = 'system' | 'light' | 'dark';
export type MotionPreference = 'system' | 'reduce';

export interface Appearance {
  theme: ThemePreference;
  motion: MotionPreference;
}

export const APPEARANCE_KEY = 'appearance';
const DEFAULT: Appearance = { theme: 'system', motion: 'system' };

/** Applies the preference to <html>; 'system' removes the attribute so CSS media queries decide. */
export function applyAppearance(a: Appearance, root: HTMLElement = document.documentElement): void {
  if (a.theme === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', a.theme);
  if (a.motion === 'reduce') root.setAttribute('data-motion', 'reduce');
  else root.removeAttribute('data-motion');
}

export function prefersReducedMotion(): boolean {
  if (document.documentElement.getAttribute('data-motion') === 'reduce') return true;
  return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
}

interface AppearanceState extends Appearance {
  setTheme(theme: ThemePreference): void;
  setMotion(motion: MotionPreference): void;
}

export function createAppearanceStore(store: KeyValueStore) {
  const useAppearance = create<AppearanceState>((set, get) => {
    const persist = () => {
      const { theme, motion } = get();
      applyAppearance({ theme, motion });
      void store.set<Appearance>(APPEARANCE_KEY, { theme, motion });
    };
    return {
      ...DEFAULT,
      setTheme: (theme) => {
        set({ theme });
        persist();
      },
      setMotion: (motion) => {
        set({ motion });
        persist();
      },
    };
  });
  const sync = (a: Appearance | undefined) => {
    const next = { ...DEFAULT, ...a };
    useAppearance.setState(next);
    applyAppearance(next);
  };
  void store.get<Appearance>(APPEARANCE_KEY).then(sync);
  store.watch<Appearance>(APPEARANCE_KEY, sync);
  return useAppearance;
}
