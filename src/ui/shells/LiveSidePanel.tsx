/** The side panel (Web mode, PLAN.md §3.4.1) wired to the live reading session. */
import { useCallback, useEffect, type ReactNode } from 'react';
import { REGISTRY } from '@/engines/factory';
import { isPdfUrl, openOptions, openReader, tabUrl } from '@/platform/tabs';
import type { SessionInfo, UiCommand } from '@/runtime/protocol';
import { DEFAULT_SKIP_RULES } from '@/core/text/skip';
import { BookOpen, FileText, MoreHorizontal, Settings, SkipBack, SkipForward } from '../icons';
import { Button, EmptyState, IconButton, Menu, Select, Tabs, Toggle } from '../components';
import { DocRules, WEB_RULES } from '../controls/DocRules';
import { EngineStatus } from '../controls/EngineStatus';
import { ExportPanel } from '../controls/ExportPanel';
import { SleepTimerSelect } from '../controls/SleepTimer';
import { PlayButton } from '../controls/PlayButton';
import { SpeedControl } from '../controls/SpeedControl';
import { VoiceControl, type VoiceOption } from '../controls/VoiceControl';
import { formatTimeLeft } from '../format';
import { ReadingView } from '../reading/ReadingView';
import { secondsLeft } from '../session/docView';
import { useSession } from '../session/useSession';
import type { useAppearanceHook } from './types';
import { useState } from 'react';

const ACTIVE = new Set(['playing', 'buffering', 'preparing', 'seeking', 'retrying']);

function engineText(s: SessionInfo): { state: 'ready' | 'loading' | 'error'; text: string } {
  if (s.error) return { state: 'error', text: s.error };
  if (s.state === 'preparing' || s.state === 'retrying')
    return { state: 'loading', text: 'Starting the voice…' };
  const engine = s.engine ?? s.settings.engineId;
  if (engine === 'system') return { state: 'ready', text: 'System voice' };
  if (engine === 'test') return { state: 'ready', text: 'On-device · Test tone' };
  const name = engine === 'kokoro' ? 'Kokoro' : engine === 'piper' ? 'Piper' : engine;
  const backend = (s.backend ?? s.settings.backend) === 'webgpu' ? 'WebGPU' : 'WASM';
  return {
    state: 'ready',
    text: `On-device · ${name} · ${backend}`,
  };
}

function voicesFor(s: SessionInfo | null): VoiceOption[] {
  const m =
    REGISTRY.models.find((x) => x.id === s?.settings.modelId) ??
    REGISTRY.models.find((x) => x.engine === s?.settings.engineId);
  if (!m)
    return s
      ? [{ id: s.settings.voice, name: s.settings.voice || 'System voice', detail: 'System' }]
      : [];
  return m.voices.map((v) => ({ id: v.id, name: v.name, detail: `${m.displayName} · ${v.lang}` }));
}

export function LiveSidePanel({ useAppearance }: { useAppearance: useAppearanceHook }) {
  const { session, doc, view, live, tabId, send } = useSession();
  const { theme, setTheme } = useAppearance();
  const [follow, setFollow] = useState(true);
  const [pdfUrl, setPdfUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (tabId !== undefined) void tabUrl(tabId).then((u) => setPdfUrl(isPdfUrl(u) ? u : undefined));
  }, [tabId]);
  const playing = !!session && ACTIVE.has(session.state);
  const cmd = useCallback((c: UiCommand) => send(c), [send]);
  const readPage = () => tabId !== undefined && cmd({ type: 'READ_TAB', tabId });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (
        e.metaKey ||
        e.ctrlKey ||
        e.altKey ||
        (t &&
          (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) ||
            t.getAttribute('role') === 'slider'))
      )
        return;
      const map: Record<string, UiCommand> = {
        j: { type: 'PREV_SENTENCE' },
        k: { type: 'NEXT_SENTENCE' },
        J: { type: 'PREV_BLOCK' },
        K: { type: 'NEXT_BLOCK' },
        Escape: { type: 'STOP' },
      };
      if (e.key === ' ' && !t?.closest('button,[role=tab],[role=radio],a')) {
        e.preventDefault();
        if (session) cmd({ type: 'TOGGLE' });
        else readPage();
      } else if (map[e.key] && session) cmd(map[e.key] as UiCommand);
      else if ((e.key === '-' || e.key === '=') && session)
        cmd({
          type: 'SET_SPEED',
          rate: Math.min(
            4,
            Math.max(0.5, +(session.settings.rate + (e.key === '=' ? 0.25 : -0.25)).toFixed(2)),
          ),
        });
      else if (e.key === 'f') setFollow((f) => !f);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const currentView =
    live.sentenceId && view
      ? (view.viewIndexOf.get(live.sentenceId) ?? -1)
      : session && view
        ? (view.viewIndexOf.get(view.nav.at(session.cursor.sentence)?.sentence.id ?? '') ?? -1)
        : -1;
  const onSeek = useCallback(
    (i: number) => {
      const target = view?.toPlayer[i] ?? -1;
      if (target >= 0) cmd({ type: 'SEEK', sentence: target });
    },
    [view, cmd],
  );

  const menu = (
    <Menu
      trigger={
        <IconButton label="More" size="sm">
          <MoreHorizontal size={18} aria-hidden />
        </IconButton>
      }
      items={[
        {
          label: 'Open a PDF…',
          icon: <FileText size={16} aria-hidden />,
          onSelect: () => openOptions(''),
        },
        {
          label: 'Settings',
          icon: <Settings size={16} aria-hidden />,
          onSelect: () => openOptions('voices'),
        },
      ]}
    />
  );

  if (!session || !doc || !view) {
    return (
      <Frame header={<Header title="Open Reader" site="Read any article aloud" menu={menu} />}>
        <main id="content" className="flex-1">
          <EmptyState
            icon={<BookOpen size={24} aria-hidden />}
            title="Nothing is playing"
            body={
              session?.error ??
              'Read the article in this tab, or right-click any page and choose Read page from here. Alt+click a word to start there.'
            }
            action={
              pdfUrl ? (
                <Button variant="primary" onClick={() => openReader(pdfUrl)}>
                  Open in Open Reader
                </Button>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <Button variant="primary" onClick={readPage} disabled={tabId === undefined}>
                    Read this page
                  </Button>
                  <Button onClick={() => openReader()}>Open a PDF…</Button>
                </div>
              )
            }
          />
        </main>
        <footer className="border-t border-line px-4 py-2.5">
          <EngineStatus state="ready" text="Offline ready" />
        </footer>
      </Frame>
    );
  }

  const status = engineText(session);
  const total = view.nav.length;
  const at = Math.min(total, session.cursor.sentence + 1);
  const headings = view.blocks
    .map((b) => ({
      b,
      first: view.toPlayer[view.viewIndexOf.get(b.sentences[0]?.id ?? '') ?? -1] ?? -1,
    }))
    .filter((x) => x.b.type === 'heading' && x.first >= 0);
  let site = '';
  try {
    site = session.url ? new URL(session.url).hostname : '';
  } catch {
    site = '';
  }

  return (
    <Frame header={<Header title={doc.title} site={site} menu={menu} />}>
      <section aria-label="Playback" className="border-y border-line px-4 py-4">
        <div className="flex items-center justify-center gap-3">
          <IconButton
            label="Previous sentence"
            shortcut="J"
            onClick={() => cmd({ type: 'PREV_SENTENCE' })}
          >
            <SkipBack size={20} aria-hidden />
          </IconButton>
          <PlayButton
            playing={playing}
            onToggle={() => cmd(session.state === 'error' ? { type: 'RETRY' } : { type: 'TOGGLE' })}
          />
          <IconButton
            label="Next sentence"
            shortcut="K"
            onClick={() => cmd({ type: 'NEXT_SENTENCE' })}
          >
            <SkipForward size={20} aria-hidden />
          </IconButton>
        </div>
        <div className="mt-3 flex items-center justify-between gap-2">
          <SpeedControl
            rate={session.settings.rate}
            onRateChange={(rate) => cmd({ type: 'SET_SPEED', rate })}
          />
          <VoiceControl
            voice={session.settings.voice}
            voices={voicesFor(session)}
            onVoiceChange={(voice) => cmd({ type: 'SET_VOICE', voice })}
          />
        </div>
        <div className="mt-4">
          <div
            className="h-0.5 w-full rounded-full bg-line"
            role="progressbar"
            aria-label="Reading progress"
            aria-valuemin={1}
            aria-valuemax={Math.max(1, total)}
            aria-valuenow={at}
            aria-valuetext={`Sentence ${at} of ${total}`}
          >
            <div
              className="h-full w-full origin-left rounded-full bg-ink transition-transform duration-(--dur)"
              style={{ transform: `scaleX(${total ? at / total : 0})` }}
            />
          </div>
          <div className="mt-2 flex justify-between text-xs text-muted tabular">
            <span>
              Sentence {at} of {total}
            </span>
            <span>
              {formatTimeLeft(secondsLeft(view, session.cursor.sentence, session.settings.rate))}
            </span>
          </div>
        </div>
      </section>

      <main id="content" className="flex min-h-0 flex-1 flex-col">
        <Tabs
          label="Views"
          className="flex-1"
          panelClassName="overflow-y-auto"
          items={[
            {
              value: 'reader',
              label: 'Reader',
              content: (
                <ReadingView
                  className="mx-auto max-w-[66ch] px-5 pb-16"
                  blocks={view.blocks}
                  sentence={currentView}
                  word={live.word}
                  active={session.state !== 'idle'}
                  follow={follow}
                  onSeek={onSeek}
                />
              ),
            },
            {
              value: 'outline',
              label: 'Outline',
              content: headings.length ? (
                <nav aria-label="Outline" className="px-2 py-3">
                  <ul>
                    {headings.map(({ b, first }) => (
                      <li key={b.id}>
                        <button
                          type="button"
                          onClick={() => cmd({ type: 'SEEK', sentence: first })}
                          className="w-full rounded-control px-3 py-2 text-left font-serif text-[15px] hover:bg-hover"
                          style={{ paddingLeft: 12 + ((b.level ?? 1) - 1) * 16 }}
                        >
                          {b.sentences[0]?.text}
                        </button>
                      </li>
                    ))}
                  </ul>
                </nav>
              ) : (
                <EmptyState
                  title="No headings"
                  body="This page has no section headings to jump to."
                />
              ),
            },
            {
              value: 'settings',
              label: 'Settings',
              content: (
                <div className="flex flex-col gap-3 px-4 py-4">
                  <Toggle
                    label="Follow the voice"
                    description="Keep the current sentence in view."
                    checked={follow}
                    onCheckedChange={setFollow}
                  />
                  <Select
                    label="Pauses"
                    value={session.settings.pacing}
                    onValueChange={(v) =>
                      cmd({ type: 'SET_PACING', pacing: v as 'brisk' | 'natural' | 'relaxed' })
                    }
                    options={[
                      { value: 'brisk', label: 'Brisk' },
                      { value: 'natural', label: 'Natural' },
                      { value: 'relaxed', label: 'Relaxed' },
                    ]}
                  />
                  <SleepTimerSelect
                    value={session.sleep}
                    onChange={(sleep) => cmd({ type: 'SET_SLEEP', sleep })}
                  />
                  <DocRules
                    rules={session.settings.skipRules ?? DEFAULT_SKIP_RULES}
                    custom={!!session.docRules}
                    keys={WEB_RULES}
                    onChange={(rules) => cmd({ type: 'SET_DOC_RULES', rules })}
                  />
                  <ExportPanel
                    job={session.exportJob}
                    disabled={
                      session.settings.engineId === 'system'
                        ? 'System voices can’t be saved as audio. Choose an on-device voice to export an audiobook.'
                        : undefined
                    }
                    onStart={(format) => cmd({ type: 'EXPORT', format })}
                    onCancel={() => cmd({ type: 'EXPORT_CANCEL' })}
                  />
                  <Select
                    label="Theme"
                    value={theme}
                    onValueChange={(v) => setTheme(v as typeof theme)}
                    options={[
                      { value: 'system', label: 'Match system' },
                      { value: 'light', label: 'Light' },
                      { value: 'dark', label: 'Dark' },
                    ]}
                  />
                  <Button size="sm" onClick={() => openOptions('voices')}>
                    All settings
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </main>

      <footer className="border-t border-line px-4 py-2.5">
        <EngineStatus state={status.state} text={status.text} />
      </footer>
    </Frame>
  );
}

function Frame({ header, children }: { header: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-screen min-w-[320px] flex-col bg-paper text-ink">
      <a
        href="#content"
        className="fixed top-2 left-2 z-50 -translate-y-16 rounded-control bg-ink px-3 py-2 text-sm text-paper transition-quiet focus-visible:translate-y-0"
      >
        Skip to content
      </a>
      {header}
      {children}
    </div>
  );
}

function Header({ title, site, menu }: { title: string; site: string; menu: ReactNode }) {
  return (
    <header className="flex items-start gap-2 px-4 pt-4 pb-3">
      <div className="min-w-0 flex-1">
        <h1 className="line-clamp-2 font-serif text-[19px] leading-tight tracking-[-0.015em] text-balance">
          {title}
        </h1>
        <p className="mt-1 truncate text-xs text-muted">{site}</p>
      </div>
      {menu}
    </header>
  );
}
