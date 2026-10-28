import { describe, expect, it } from 'vitest';
import { memoryStore } from '@/platform/kv';
import { APPEARANCE_KEY, applyAppearance, createAppearanceStore } from '@/ui/theme';

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('appearance', () => {
  it('system theme removes data-theme so media queries decide', () => {
    const el = document.createElement('html');
    applyAppearance({ theme: 'dark', motion: 'reduce' }, el);
    expect(el.getAttribute('data-theme')).toBe('dark');
    expect(el.getAttribute('data-motion')).toBe('reduce');
    applyAppearance({ theme: 'system', motion: 'system' }, el);
    expect(el.hasAttribute('data-theme')).toBe(false);
    expect(el.hasAttribute('data-motion')).toBe(false);
  });

  it('loads the persisted preference and writes changes back', async () => {
    const store = memoryStore({ [APPEARANCE_KEY]: { theme: 'light', motion: 'system' } });
    const use = createAppearanceStore(store);
    await flush();
    expect(use.getState().theme).toBe('light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    use.getState().setTheme('dark');
    expect(await store.get(APPEARANCE_KEY)).toEqual({ theme: 'dark', motion: 'system' });
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('follows changes made in another context', async () => {
    const store = memoryStore();
    const use = createAppearanceStore(store);
    await flush();
    await store.set(APPEARANCE_KEY, { theme: 'dark', motion: 'reduce' });
    expect(use.getState()).toMatchObject({ theme: 'dark', motion: 'reduce' });
  });
});
