import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { DEFAULT_SETTINGS } from '@/core/settings';
import { buildBlock } from '@/core/document/build';
import { localStore } from '@/platform/kv';
import { IdbLibrary } from '@/platform/library';
import { ChromeSessionStore } from '@/platform/session';
import { loadSettings, saveSettings, watchSettings } from '@/platform/settings';
import { DEFAULT_SESSION_SETTINGS, type SessionInfo } from '@/runtime/protocol';

beforeEach(() => fakeBrowser.reset());

describe('localStore (chrome.storage.local)', () => {
  it('gets, sets and watches keys', async () => {
    const kv = localStore();
    const seen: unknown[] = [];
    const off = kv.watch('k', (v) => seen.push(v));
    await kv.set('k', { a: 1 });
    expect(await kv.get('k')).toEqual({ a: 1 });
    await kv.set('other', 1);
    off();
    await kv.set('k', 2);
    expect(seen).toEqual([{ a: 1 }]);
  });
});

describe('settings', () => {
  it('loads defaults, saves patches and notifies watchers', async () => {
    expect(await loadSettings()).toEqual(DEFAULT_SETTINGS);
    const seen: number[] = [];
    const off = watchSettings((s) => seen.push(s.rate));
    expect((await saveSettings({ rate: 1.75 })).rate).toBe(1.75);
    expect((await loadSettings()).rate).toBe(1.75);
    off();
    expect(seen).toEqual([1.75]);
  });
});

describe('ChromeSessionStore', () => {
  it('stores the session and only the current document', async () => {
    const s = new ChromeSessionStore();
    expect(await s.loadSession()).toBeNull();
    const info: SessionInfo = {
      sessionId: 'x',
      docId: 'd1',
      title: 't',
      host: 'offscreen',
      state: 'idle',
      cursor: { sentence: 0, part: 0, word: 0 },
      settings: DEFAULT_SESSION_SETTINGS,
      sentenceCount: 1,
      hostLost: false,
      error: null,
      updatedAt: 0,
    };
    await s.saveSession(info);
    expect(await s.loadSession()).toEqual(info);
    const doc = (id: string) => ({
      id,
      kind: 'web' as const,
      title: '',
      lang: 'en',
      blocks: [buildBlock({ id: 'p', type: 'paragraph', text: 'Hi.' })],
    });
    await s.saveDoc(doc('d1'));
    await s.saveDoc(doc('d2'));
    expect(await s.loadDoc('d1')).toBeUndefined();
    expect((await s.loadDoc('d2'))?.id).toBe('d2');
    await s.saveSession(null);
    expect(await s.loadSession()).toBeNull();
  });
});

describe('IdbLibrary', () => {
  it('saves positions and lists recent documents', async () => {
    const lib = new IdbLibrary(`lib-${Math.random()}`);
    await lib.savePosition(
      { docId: 'a', sentenceId: 'p.1', word: 2, updatedAt: 10 },
      { title: 'A', url: 'https://a.test', kind: 'web' },
    );
    await lib.savePosition(
      { docId: 'b', sentenceId: 'p.0', word: 0, updatedAt: 20 },
      { title: 'B', kind: 'pdf' },
    );
    await lib.savePosition(
      { docId: 'a', sentenceId: 'p.4', word: 0, updatedAt: 30 },
      { title: '', kind: 'web' },
    );
    expect(await lib.getPosition('a')).toMatchObject({ sentenceId: 'p.4' });
    const recent = await lib.recent();
    expect(recent.map((r) => r.docId)).toEqual(['a', 'b']);
    expect(recent[0]).toMatchObject({ title: 'A', url: 'https://a.test' });
    expect(await lib.getPosition('zzz')).toBeUndefined();
  });
});
