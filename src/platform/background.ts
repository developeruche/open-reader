import { browser, type Browser } from 'wxt/browser';
import { IdbLibrary } from './library';
import { closeOffscreen, ensureOffscreen, offscreenExists } from './offscreen';
import { ChromeSessionStore } from './session';
import { loadSettings } from './settings';
import { chromeTts } from './tts';
import { INSTALLED_KEY, type InstalledIndex } from '@/core/models/manager';
import { localStore } from './kv';
import { Orchestrator, type DebugEvent } from '@/runtime/orchestrator';
import {
  DEFAULT_SESSION_SETTINGS,
  parseUiCommand,
  PORT,
  type ContentMessage,
  type ContentUpdate,
  type HostCommand,
  type HostEvent,
  type UiMessage,
  type UiUpdate,
} from '@/runtime/protocol';

const MENU = { selection: 'read-selection', page: 'read-page', pdfLink: 'read-pdf-link' } as const;
const TEST = import.meta.env.MODE === 'test';

/** Wires the orchestrator to chrome.* (ports, commands, menus, side panel). */
export function startBackground(): void {
  void browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

  const debugLog: DebugEvent[] = [];
  const tts = chromeTts();
  const uiPorts = new Set<Browser.runtime.Port>();
  const contentPorts = new Map<number, Browser.runtime.Port>();
  const pendingExtract = new Map<number, boolean>();

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
      async extract(tabId, fromSelection) {
        const port = contentPorts.get(tabId);
        if (port)
          return port.postMessage({ type: 'EXTRACT', fromSelection } satisfies ContentUpdate);
        pendingExtract.set(tabId, fromSelection);
        try {
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
              message: `This page can't be read: ${e instanceof Error ? e.message : String(e)}`,
            },
          });
        }
      },
    },
    async settings() {
      const s = await loadSettings();
      // Default: the chosen voice; else Kokoro if installed; else system voices (zero download).
      // Test builds use the deterministic TestEngine unless a test chose a voice.
      let voice = s.voice;
      if (!voice && !TEST) {
        const installed = (await localStore().get<InstalledIndex>(INSTALLED_KEY)) ?? {};
        const kokoro = Object.values(installed).find((m) => m.modelId.startsWith('kokoro'));
        voice = kokoro
          ? { engineId: 'kokoro', modelId: kokoro.modelId, voice: 'af_heart' }
          : { engineId: 'system', voice: '' };
      }
      if (!voice) return { ...DEFAULT_SESSION_SETTINGS, rate: s.rate, pacing: s.pacing };
      return {
        rate: s.rate,
        pacing: s.pacing,
        engineId: voice.engineId,
        modelId: voice.modelId,
        backend: voice.backend,
        voice: voice.voice,
      };
    },
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
            void orch
              .whenRestored()
              .then(() =>
                port.postMessage({ type: 'SESSION', session: orch.session } satisfies UiUpdate),
              );
          if (msg.type === 'COMMAND') {
            const cmd = parseUiCommand(msg.command);
            if (cmd) void orch.command(cmd);
          }
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
          if (msg.type === 'DOC')
            void orch.contentDoc(
              tabId,
              msg.doc,
              msg.url,
              msg.startSentence >= 0 ? msg.startSentence : undefined,
            );
          if (msg.type === 'NO_CONTENT')
            broadcast({
              type: 'NOTICE',
              notice: { kind: 'info', message: 'No readable text was found on this page.' },
            });
        });
        const pending = pendingExtract.get(tabId);
        if (pending !== undefined) {
          pendingExtract.delete(tabId);
          port.postMessage({ type: 'EXTRACT', fromSelection: pending } satisfies ContentUpdate);
        }
        break;
      }
    }
  });

  browser.commands.onCommand.addListener((name) => void orch.keyboardCommand(name));

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
    if (info.menuItemId === MENU.pdfLink && info.linkUrl) {
      void browser.tabs.create({
        url: browser.runtime.getURL(`/reader.html?src=${encodeURIComponent(info.linkUrl)}`),
      });
      return;
    }
    if (tabId === undefined) return;
    // A context-menu click is a user gesture, so the side panel may open (Chrome 116+).
    void browser.sidePanel.open({ tabId }).catch(() => undefined);
    void orch.command({
      type: 'READ_TAB',
      tabId,
      fromSelection: info.menuItemId === MENU.selection,
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
