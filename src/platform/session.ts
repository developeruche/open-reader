/** Live session state in chrome.storage.session (survives service worker restarts, not browser restarts). */
import { browser } from 'wxt/browser';
import type { ReadingDocument } from '@/core/document/model';
import type { SessionStore } from '@/runtime/orchestrator';
import type { SessionInfo } from '@/runtime/protocol';

const SESSION_KEY = 'session';
const docKey = (id: string) => `doc:${id}`;

export class ChromeSessionStore implements SessionStore {
  async loadSession(): Promise<SessionInfo | null> {
    const r = await browser.storage.session.get(SESSION_KEY);
    return (r[SESSION_KEY] as SessionInfo | undefined) ?? null;
  }

  async saveSession(s: SessionInfo | null): Promise<void> {
    if (s) await browser.storage.session.set({ [SESSION_KEY]: s });
    else await browser.storage.session.remove(SESSION_KEY);
  }

  async saveDoc(doc: ReadingDocument): Promise<void> {
    // Keep only the current document; storage.session is limited (10 MB).
    const all = await browser.storage.session.get(null);
    const stale = Object.keys(all).filter((k) => k.startsWith('doc:') && k !== docKey(doc.id));
    if (stale.length) await browser.storage.session.remove(stale);
    await browser.storage.session.set({ [docKey(doc.id)]: doc });
  }

  async loadDoc(docId: string): Promise<ReadingDocument | undefined> {
    const r = await browser.storage.session.get(docKey(docId));
    return r[docKey(docId)] as ReadingDocument | undefined;
  }
}
