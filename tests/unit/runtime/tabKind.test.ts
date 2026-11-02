import { describe, expect, it } from 'vitest';
import { sameDocument, tabKind } from '@/runtime/tabKind';

describe('tabKind', () => {
  it.each([
    ['https://developeruche.com/private/pqts-breakouts/', 'web'],
    ['file:///Users/me/notes.html', 'web'],
    ['https://ex.test/paper.pdf?dl=1#page=2', 'pdf'],
    ['file:///Users/me/paper.PDF', 'pdf'],
    ['chrome://extensions/', 'blocked'],
    ['chrome-extension://abc/options.html', 'blocked'],
    ['https://chromewebstore.google.com/detail/x', 'blocked'],
    ['about:blank', 'blocked'],
    ['data:text/html,hi', 'blocked'],
    [undefined, 'none'],
  ])('%s → %s', (url, kind) => expect(tabKind(url)).toBe(kind));

  it('treats a #fragment change as the same document', () => {
    expect(sameDocument('https://a.test/x#one', 'https://a.test/x')).toBe(true);
    expect(sameDocument('https://a.test/x', 'https://a.test/y')).toBe(false);
    expect(sameDocument(undefined, 'https://a.test/y')).toBe(false);
  });
});
