import { browser, type Browser } from 'wxt/browser';
import { IdbLibrary } from './library';
import { IdbLexicon } from './lexicon';
import { downloadAndWait } from './downloads';
import { closeOffscreen, ensureOffscreen, offscreenExists } from './offscreen';
import { ChromeSessionStore } from './session';
import { loadSettings, watchSettings } from './settings';
import { setPdfInterception } from './pdfIntercept';
import { chromeTts } from './tts';
import { INSTALLED_KEY, type InstalledIndex } from '@/core/models/manager';
import { localStore } from './kv';
import { Orchestrator, type DebugEvent } from '@/runtime/orchestrator';
import { sessionSettingsFrom } from '@/runtime/sessionSettings';
import { HIGHLIGHT_CSS } from '@/web/highlightCss';
import {
  parseUiCommand,
  PORT,
  type ContentMessage,
  type ContentUpdate,
  type HostCommand,
  type HostEvent,
  type UiMessage,
  type UiUpdate,
} from '@/runtime/protocol';

const MENU = {
  selection: 'read-selection',
  page: 'read-page',
  pdfLink: 'read-pdf-link',
  actionPdf: 'action-open-pdf',
  actionRead: 'action-read-page',
} as const;
const TEST = import.meta.env.MODE === 'test';

/** Wires the orchestrator to chrome.* (ports, commands, menus, side panel). */
export function startBackground(): void {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  const debugLog: DebugEvent[] = [];
  const lexicon = new IdbLexicon();
  const tts = chromeTts();
  const uiPorts = new Set<Browser.runtime.Port>();
  const contentPorts = new Map<number, Browser.runtime.Port>();
  const pendingExtract = new Map<number, { fromSelection: boolean; fromHere: boolean }>();

  const broadcast = (u: UiUpdate) => {
    for (const p of uiPorts) p.postMessage(u);
  };

  const orch = new Orchestrator({
    store: new ChromeSessionStore(),
    library: new IdbLibrary(),
    offscreen: { ensure: ensureOffscreen, exists: offscreenExists },
    ui: { broadcast },
    content: {
      send(tabId, u: ContentUpdate) {
        contentPorts.get(tabId)?.postMessage(u);
      },
      async extract(tabId, fromSelection, fromHere = false) {
        const port = contentPorts.get(tabId);
        if (port)
          return port.postMessage({
            type: 'EXTRACT',
            fromSelection,
            fromHere,
          } satisfies ContentUpdate);
        pendingExtract.set(tabId, { fromSelection, fromHere });
        try {
          await browser.scripting.insertCSS({ target: { tabId }, css: HIGHLIGHT_CSS });
          await browser.scripting.executeScript({
            target: { tabId },
            files: ['/content-scripts/content.js'],
          });
        } catch (e) {
          pendingExtract.delete(tabId);
          broadcast({
            type: 'NOTICE',
            notice: {
              kind: 'error',
              message:
                "This page can't be read. Chrome blocks extensions on its own pages and the Web Store; for a PDF, use Open a PDF… in the side panel menu.",
              detail: e instanceof Error ? e.message : String(e),
            },
          });
        }
      },
    },
    async settings() {
      const installed = (await localStore().get<InstalledIndex>(INSTALLED_KEY)) ?? {};
      return sessionSettingsFrom(await loadSettings(), installed, TEST, await lexicon.list());
    },
    download: downloadAndWait,
    openTab,
    async activeTabId() {
      const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
      return tab?.id;
    },
    now: () => Date.now(),
    newId: () => crypto.randomUUID(),
    debug: TEST
      ? (e) => {
          debugLog.push(e);
          if (debugLog.length > 5000) debugLog.splice(0, 1000);
        }
      : undefined,
  });

  browser.runtime.onConnect.addListener((port) => {
    switch (port.name) {
      case PORT.engineHost:
      case PORT.inpageHost: {
        const kind = port.name === PORT.engineHost ? 'offscreen' : 'inpage';
        orch.hostConnected(kind, { send: (cmd) => port.postMessage(cmd) });
        port.onMessage.addListener((m: unknown) => {
          const e = m as HostEvent;
          // The offscreen host has no chrome.tts: speak for it and relay word events back.
          if (e.type === 'TTS') {
            if (e.op === 'speak')
              tts.speak(e.text, e.options, (event) =>
                port.postMessage({ type: 'TTS_EVENT', id: e.id, event } satisfies HostCommand),
              );
            else tts[e.op]();
            return;
          }
          void orch.hostEvent(kind, e);
        });
        port.onDisconnect.addListener(() => void orch.hostDisconnected(kind));
        break;
      }
      case PORT.ui: {
        uiPorts.add(port);
        port.onDisconnect.addListener(() => uiPorts.delete(port));
        port.onMessage.addListener((m: unknown) => {
          const msg = m as UiMessage;
          if (msg.type === 'HELLO')
            void orch.whenRestored().then(async () => {
              port.postMessage({ type: 'SESSION', session: orch.session } satisfies UiUpdate);
              const doc = await orch.currentDoc();
              if (doc) port.postMessage({ type: 'DOC', doc } satisfies UiUpdate);
            });
          if (msg.type === 'COMMAND') {
            const cmd = parseUiCommand(msg.command);
            if (cmd) void orch.command(cmd);
          }
          if (msg.type === 'DIAGNOSTICS')
            void orch.whenRestored().then(() =>
              port.postMessage({
                type: 'DIAGNOSTICS',
                report: orch.diagnostics(),
              } satisfies UiUpdate),
            );
        });
        break;
      }
      case PORT.content: {
        const tabId = port.sender?.tab?.id;
        if (tabId === undefined) return;
        contentPorts.set(tabId, port);
        port.onDisconnect.addListener(
          () => contentPorts.get(tabId) === port && contentPorts.delete(tabId),
        );
        port.onMessage.addListener((m: unknown) => {
          const msg = m as ContentMessage;
          if (msg.type === 'DOC') void orch.contentDoc(tabId, msg.doc, msg.url, msg.startAt);
          if (msg.type === 'SEEK') void orch.contentSeek(tabId, msg.docId, msg.at);
          if (msg.type === 'COMMAND') {
            const cmd = parseUiCommand(msg.command);
            if (cmd) void orch.command(cmd);
          }
          if (msg.type === 'NOTE')
            broadcast({ type: 'NOTICE', notice: { kind: 'info', message: msg.message } });
          if (msg.type === 'NO_CONTENT')
            broadcast({
              type: 'NOTICE',
              notice: {
                kind: 'info',
                message:
                  'No readable text was found on this page. Select some text and choose Read selection aloud from the right-click menu.',
              },
            });
        });
        const pending = pendingExtract.get(tabId);
        if (pending !== undefined) {
          pendingExtract.delete(tabId);
          port.postMessage({ type: 'EXTRACT', ...pending } satisfies ContentUpdate);
        }
        break;
      }
    }
  });

  void loadSettings().then((s) => setPdfInterception(s.interceptPdf));
  let intercept: boolean | undefined;
  let lexiconKey: string | undefined;
  void loadSettings().then((s) => (lexiconKey ??= `${s.lexiconRevision}|${s.packs.join(',')}`));
  watchSettings((s) => {
    if (s.interceptPdf !== intercept) void setPdfInterception((intercept = s.interceptPdf));
    // Pronunciations or packs changed in Settings: re-plan the open session (§5.2.4).
    const key = `${s.lexiconRevision}|${s.packs.join(',')}`;
    if (lexiconKey !== undefined && key !== lexiconKey)
      void orch.command({ type: 'SETTINGS_CHANGED' });
    lexiconKey = key;
  });

  browser.commands.onCommand.addListener((name) => void orch.keyboardCommand(name));

  // A session ends when its tab closes or leaves the page (the side panel then offers the new one).
  browser.tabs.onRemoved.addListener((tabId) => void orch.tabGone(tabId));
  browser.tabs.onUpdated.addListener((tabId, change) => {
    if (change.url) void orch.tabGone(tabId, change.url);
  });

  browser.runtime.onInstalled.addListener((details) => {
    if (details.reason === 'install' && !TEST)
      void browser.tabs.create({ url: browser.runtime.getURL('/onboarding.html') });
    browser.contextMenus.removeAll(() => {
      browser.contextMenus.create({
        id: MENU.selection,
        title: 'Read selection aloud',
        contexts: ['selection'],
      });
      browser.contextMenus.create({
        id: MENU.page,
        title: 'Read page from here',
        contexts: ['page'],
      });
      // Right-click on the toolbar icon.
      browser.contextMenus.create({
        id: MENU.actionRead,
        title: 'Read this page',
        contexts: ['action'],
      });
      browser.contextMenus.create({
        id: MENU.actionPdf,
        title: 'Open a PDF…',
        contexts: ['action'],
      });
      browser.contextMenus.create({
        id: MENU.pdfLink,
        title: 'Read PDF in Open Reader',
        contexts: ['link'],
        targetUrlPatterns: ['*://*/*.pdf', '*://*/*.pdf?*', 'file:///*.pdf'],
      });
    });
  });

  browser.contextMenus.onClicked.addListener((info, tab) => {
    const tabId = tab?.id;
    if (info.menuItemId === MENU.actionPdf) {
      void browser.tabs.create({ url: browser.runtime.getURL('/reader.html') });
      return;
    }
    if (info.menuItemId === MENU.actionRead && tabId !== undefined) {
      void browser.sidePanel.open({ tabId }).catch(() => undefined);
      void orch.readTab(tabId, { fromSelection: false, fromHere: false });
      return;
    }
    if (info.menuItemId === MENU.pdfLink && info.linkUrl) {
      void browser.tabs.create({
        url: browser.runtime.getURL(`/reader.html?src=${encodeURIComponent(info.linkUrl)}`),
      });
      return;
    }
    if (tabId === undefined) return;
    // A context-menu click is a user gesture, so the side panel may open (Chrome 116+).
    void browser.sidePanel.open({ tabId }).catch(() => undefined);
    void orch.readTab(tabId, {
      fromSelection: info.menuItemId === MENU.selection,
      fromHere: info.menuItemId === MENU.page,
    });
  });

  if (TEST) {
    // Test-only debug channel (PLAN.md §11): Playwright reads it through the service worker.
    Object.assign(globalThis, {
      __openReader: {
        orch,
        debugLog,
        command: (c: unknown) => {
          const cmd = parseUiCommand(c);
          if (!cmd) throw new Error(`bad command ${JSON.stringify(c)}`);
          return orch.command(cmd);
        },
        keyboardCommand: (name: string) => orch.keyboardCommand(name),
        closeOffscreen,
        offscreenExists,
      },
    });
  }
}

/** Focuses a tab already showing `url`, or opens one, and resolves once it has loaded. */
async function openTab(url: string): Promise<number | undefined> {
  const base = url.split('#')[0];
  const open = (await browser.tabs.query({})).find((t) => t.url?.split('#')[0] === base);
  const tab = open
    ? await browser.tabs.update(open.id ?? -1, { active: true })
    : await browser.tabs.create({ url, active: true });
  const id = tab?.id;
  if (id === undefined || tab?.status === 'complete') return id;
  return new Promise((resolve) => {
    const done = (tabId: number, change: { status?: string }) => {
      if (tabId !== id || change.status !== 'complete') return;
      browser.tabs.onUpdated.removeListener(done);
      resolve(id);
    };
    browser.tabs.onUpdated.addListener(done);
    setTimeout(() => {
      browser.tabs.onUpdated.removeListener(done);
      resolve(id);
    }, 20_000);
  });
}
