import { beforeEach, describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  focusTab,
  openReader,
  openReaderDoc,
  watchActiveTab,
  type ActiveTab,
} from '@/platform/tabs';

beforeEach(async () => {
  fakeBrowser.reset();
  // The fake needs a window for tabs to live in and for `currentWindow` queries.
  await fakeBrowser.windows.create({ focused: true });
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe('watchActiveTab', () => {
  it('reports the tab in front, then follows switches, navigation and closing', async () => {
    const a = await fakeBrowser.tabs.create({ url: 'https://ex.test/a', active: true });
    const seen: ActiveTab[] = [];
    const stop = watchActiveTab((t) => seen.push(t), '');
    await settle();
    expect(seen.at(-1)).toMatchObject({ tabId: a.id, url: 'https://ex.test/a' });

    const b = await fakeBrowser.tabs.create({ url: 'https://ex.test/b', active: true });
    await fakeBrowser.tabs.onActivated.trigger({ tabId: b.id ?? -1, windowId: b.windowId ?? -1 });
    await settle();
    expect(seen.at(-1)).toMatchObject({ tabId: b.id, url: 'https://ex.test/b' });

    await fakeBrowser.tabs.update(b.id ?? -1, { url: 'https://ex.test/c' });
    await fakeBrowser.tabs.onUpdated.trigger(
      b.id ?? -1,
      { url: 'https://ex.test/c' },
      (await fakeBrowser.tabs.get(b.id ?? -1)) as never,
    );
    await settle();
    expect(seen.at(-1)).toMatchObject({ url: 'https://ex.test/c' });

    // Other tabs' updates are ignored.
    const n = seen.length;
    await fakeBrowser.tabs.onUpdated.trigger(
      a.id ?? -1,
      { title: 'x' },
      (await fakeBrowser.tabs.get(a.id ?? -1)) as never,
    );
    await settle();
    expect(seen).toHaveLength(n);

    // (fake-browser can't remove the active tab, so only the event fires)
    await fakeBrowser.tabs.update(a.id ?? -1, { active: true });
    await fakeBrowser.tabs.onRemoved.trigger(b.id ?? -1, {
      windowId: b.windowId ?? -1,
      isWindowClosing: false,
    });
    await settle();
    expect(seen.at(-1)?.tabId).not.toBe(b.id);
    stop();
  });

  it('stays on a pinned tab (tests use ?tabId=)', async () => {
    const a = await fakeBrowser.tabs.create({ url: 'https://ex.test/a' });
    const seen: ActiveTab[] = [];
    watchActiveTab((t) => seen.push(t), `?tabId=${a.id}`);
    await settle();
    expect(seen).toEqual([{ tabId: a.id, url: 'https://ex.test/a', title: undefined }]);
  });
});

describe('tab helpers', () => {
  it('opens the reader, a stored PDF, and focuses a tab', async () => {
    openReader();
    openReaderDoc('abc', 'BIP 174');
    await settle();
    const urls = (await fakeBrowser.tabs.query({})).map((t) => t.url ?? '');
    expect(urls.some((u) => u.endsWith('/reader.html'))).toBe(true);
    expect(urls.some((u) => u.endsWith('/reader.html?doc=abc&name=BIP%20174.pdf'))).toBe(true);
    const t = await fakeBrowser.tabs.create({ url: 'https://ex.test/x', active: false });
    await focusTab(t.id ?? -1);
    expect((await fakeBrowser.tabs.get(t.id ?? -1)).active).toBe(true);
  });
});
