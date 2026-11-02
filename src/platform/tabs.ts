/** Tab helpers for extension pages. */
import { browser } from 'wxt/browser';

/** The tab a side panel acts on: `?tabId=` (tests) or the active tab of this window. */
export async function targetTabId(search = location.search): Promise<number | undefined> {
  const q = new URLSearchParams(search).get('tabId');
  if (q && /^\d+$/.test(q)) return Number(q);
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

export function openOptions(section = ''): void {
  void browser.tabs.create({
    url: browser.runtime.getURL(`/options.html${section ? `#${section}` : ''}`),
  });
}

export async function tabUrl(tabId: number): Promise<string | undefined> {
  try {
    return (await browser.tabs.get(tabId)).url;
  } catch {
    return undefined;
  }
}

/** Opens Document mode, optionally on a PDF URL. */
export function openReader(src?: string): void {
  void browser.tabs.create({
    url: browser.runtime.getURL(`/reader.html${src ? `?src=${encodeURIComponent(src)}` : ''}`),
  });
}

/** Opens a stored PDF in the reader (Recent documents). */
export function openReaderDoc(docId: string, title: string): void {
  const name = encodeURIComponent(`${title || 'Document'}.pdf`);
  void browser.tabs.create({
    url: browser.runtime.getURL(`/reader.html?doc=${docId}&name=${name}`),
  });
}

export { isPdfLike as isPdfUrl } from '@/runtime/pdfUrl';

export interface ActiveTab {
  tabId?: number;
  url?: string;
  title?: string;
}

/** Brings a tab and its window to the front. */
export async function focusTab(tabId: number): Promise<void> {
  const tab = await browser.tabs.update(tabId, { active: true });
  if (tab?.windowId !== undefined) await browser.windows.update(tab.windowId, { focused: true });
}

/**
 * Follows the active tab of the side panel's window: switching tabs, and the tab navigating or
 * changing its title. `?tabId=` (tests) pins one tab instead.
 */
export function watchActiveTab(
  onChange: (t: ActiveTab) => void,
  search = location.search,
): () => void {
  const pinned = new URLSearchParams(search).get('tabId');
  let windowId: number | undefined;
  let current: number | undefined;
  const report = async (tabId: number | undefined) => {
    current = tabId;
    if (tabId === undefined) return onChange({});
    try {
      const t = await browser.tabs.get(tabId);
      if (tabId === current) onChange({ tabId, url: t.url, title: t.title });
    } catch {
      onChange({});
    }
  };
  const onActivated = (i: { tabId: number; windowId: number }) => {
    if (!pinned && (windowId === undefined || i.windowId === windowId)) void report(i.tabId);
  };
  const onUpdated = (tabId: number, change: { url?: string; title?: string; status?: string }) => {
    if (tabId === current && (change.url || change.title || change.status === 'complete'))
      void report(tabId);
  };
  const onRemoved = (tabId: number) => {
    if (tabId === current && !pinned) void init();
  };
  const init = async () => {
    if (pinned && /^\d+$/.test(pinned)) return report(Number(pinned));
    const win = await browser.windows.getCurrent().catch(() => undefined);
    windowId = win?.id;
    const [tab] = await browser.tabs.query(
      windowId === undefined ? { active: true, currentWindow: true } : { active: true, windowId },
    );
    await report(tab?.id);
  };
  browser.tabs.onActivated.addListener(onActivated);
  browser.tabs.onUpdated.addListener(onUpdated);
  browser.tabs.onRemoved.addListener(onRemoved);
  void init();
  return () => {
    browser.tabs.onActivated.removeListener(onActivated);
    browser.tabs.onUpdated.removeListener(onUpdated);
    browser.tabs.onRemoved.removeListener(onRemoved);
  };
}
