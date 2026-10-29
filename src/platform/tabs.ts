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

export const isPdfUrl = (url: string | undefined) =>
  !!url && /^(https?|file):\/\/.+\.pdf(\?.*)?(#.*)?$/i.test(url);
