/** chrome.downloads for audiobook export: resolves when the file is saved (or fails). */
import { browser } from 'wxt/browser';

export async function downloadAndWait(url: string, filename: string): Promise<void> {
  const id = await browser.downloads.download({
    url,
    filename,
    saveAs: false,
    conflictAction: 'uniquify',
  });
  await new Promise<void>((resolve, reject) => {
    const listener = (d: {
      id: number;
      state?: { current?: string };
      error?: { current?: string };
    }) => {
      if (d.id !== id) return;
      if (d.state?.current === 'complete') done(resolve);
      else if (d.state?.current === 'interrupted')
        done(() =>
          reject(new Error(`The download failed (${d.error?.current ?? 'interrupted'}).`)),
        );
    };
    const done = (f: () => void) => {
      browser.downloads.onChanged.removeListener(listener);
      f();
    };
    browser.downloads.onChanged.addListener(listener);
  });
}
