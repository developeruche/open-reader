/** What the side panel can offer for a tab's URL (pure; no chrome.*). */
import { isPdfLike } from './pdfUrl';

export type TabKind = 'web' | 'pdf' | 'blocked' | 'none';

/** Chrome refuses extensions on its own pages and the Web Store. */
const BLOCKED = [
  /^(chrome|edge|brave|about|view-source|devtools|chrome-search|chrome-untrusted):/i,
  /^chrome-extension:/i,
  /^https:\/\/chromewebstore\.google\.com\//i,
  /^https:\/\/chrome\.google\.com\/webstore/i,
];

export function tabKind(url: string | undefined): TabKind {
  if (!url) return 'none';
  if (isPdfLike(url)) return 'pdf';
  if (BLOCKED.some((r) => r.test(url))) return 'blocked';
  return /^(https?|file):/i.test(url) ? 'web' : 'blocked';
}

/** The same document? Ignores the #fragment, which in-page navigation changes. */
export function sameDocument(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) return false;
  return a.split('#')[0] === b.split('#')[0];
}
