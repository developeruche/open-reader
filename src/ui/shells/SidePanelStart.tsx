/**
 * The side panel when nothing is open for the tab in front: what this tab offers (an article, a
 * PDF, or nothing readable), what is playing elsewhere, and recent documents to pick up again.
 */
import { useEffect, useState } from 'react';
import type { LibraryRow } from '@/platform/audioCache';
import { IdbLibrary } from '@/platform/library';
import { focusTab, openReader, openReaderDoc, type ActiveTab } from '@/platform/tabs';
import type { SessionInfo, UiCommand } from '@/runtime/protocol';
import { tabKind } from '@/runtime/tabKind';
import { FileText, Globe, Pause, Play, Volume2 } from '../icons';
import { Button, IconButton } from '../components';

const ACTIVE = new Set(['playing', 'buffering', 'preparing', 'seeking', 'retrying']);

export const hostOf = (url: string | undefined): string => {
  try {
    return url ? new URL(url).hostname.replace(/^www\./, '') : '';
  } catch {
    return '';
  }
};

/** What is playing in another tab, with play/pause and a way back to it. */
export function NowPlayingBar({
  session,
  title,
  send,
}: {
  session: SessionInfo;
  title: string;
  send(c: UiCommand): void;
}) {
  const playing = ACTIVE.has(session.state);
  return (
    <section
      aria-label="Now playing"
      className="flex items-center gap-3 border-y border-line bg-paper-2 px-4 py-2.5"
    >
      <IconButton
        label={playing ? 'Pause' : 'Play'}
        size="sm"
        onClick={() => send({ type: 'TOGGLE' })}
      >
        {playing ? <Pause size={16} aria-hidden /> : <Play size={16} aria-hidden />}
      </IconButton>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted">
          {playing ? 'Playing in another tab' : 'Paused in another tab'}
        </p>
        <p className="truncate text-sm">{title}</p>
      </div>
      {session.tabId !== undefined ? (
        <Button size="sm" variant="ghost" onClick={() => void focusTab(session.tabId ?? -1)}>
          Go to tab
        </Button>
      ) : null}
    </section>
  );
}

/** The tab in front: read it, open it as a PDF, or explain why it can't be read. */
export function ThisTabCard({ active, send }: { active: ActiveTab; send(c: UiCommand): void }) {
  const kind = tabKind(active.url);
  const site = hostOf(active.url);
  const readable = kind === 'web' || kind === 'pdf';
  return (
    <section aria-labelledby="this-tab" className="px-4 pt-6 pb-2">
      <p className="text-xs tracking-wide text-muted uppercase">This tab</p>
      <h2 id="this-tab" className="mt-1 line-clamp-3 font-serif text-xl leading-snug text-balance">
        {readable ? active.title || site || 'Untitled page' : "This page can't be read aloud"}
      </h2>
      {readable ? (
        <p className="mt-1 truncate text-[13px] text-muted">
          {kind === 'pdf' ? `PDF · ${site || 'local file'}` : site}
        </p>
      ) : (
        <p className="mt-2 text-[13px] text-ink-2">
          Chrome doesn't let extensions read its own pages or the Web Store. Open an article in this
          tab, or a PDF from your computer.
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2">
        {kind === 'web' ? (
          <Button
            variant="primary"
            size="lg"
            onClick={() =>
              active.tabId !== undefined && send({ type: 'READ_TAB', tabId: active.tabId })
            }
          >
            <Volume2 size={18} aria-hidden />
            Read this page
          </Button>
        ) : kind === 'pdf' ? (
          <Button variant="primary" size="lg" onClick={() => openReader(active.url)}>
            <Volume2 size={18} aria-hidden />
            Read this PDF
          </Button>
        ) : null}
        <Button size="lg" variant={readable ? 'secondary' : 'primary'} onClick={() => openReader()}>
          <FileText size={18} aria-hidden />
          Open a PDF from your computer
        </Button>
      </div>
      {kind === 'web' ? (
        <p className="mt-3 text-xs text-muted">
          Tip: press Alt+Shift+P on any page, or right-click a paragraph and choose Read page from
          here.
        </p>
      ) : null}
    </section>
  );
}

/** Recently read documents: an article reopens and continues; a PDF opens in the reader. */
export function RecentList({
  exclude,
  send,
}: {
  /** The document already shown above (its id), left out of the list. */
  exclude?: string;
  send(c: UiCommand): void;
}) {
  const [rows, setRows] = useState<LibraryRow[]>([]);
  useEffect(() => {
    void new IdbLibrary().recent(8).then(setRows);
  }, []);
  const shown = rows.filter((r) => r.docId !== exclude && (r.kind === 'pdf' || r.url)).slice(0, 6);
  if (!shown.length) return null;
  return (
    <section aria-labelledby="recent" className="px-4 pt-6 pb-4">
      <h2 id="recent" className="text-xs tracking-wide text-muted uppercase">
        Recent
      </h2>
      <ul className="mt-2 divide-y divide-line border-y border-line">
        {shown.map((r) => (
          <li key={r.docId}>
            <button
              type="button"
              className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-hover"
              onClick={() =>
                r.kind === 'pdf'
                  ? openReaderDoc(r.docId, r.title)
                  : r.url && send({ type: 'READ_URL', url: r.url })
              }
            >
              {r.kind === 'pdf' ? (
                <FileText size={16} aria-hidden className="shrink-0 text-muted" />
              ) : (
                <Globe size={16} aria-hidden className="shrink-0 text-muted" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm">{r.title || 'Untitled'}</span>
                <span className="block truncate text-xs text-muted">
                  {r.kind === 'pdf' ? 'PDF' : hostOf(r.url)} ·{' '}
                  {new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
                    r.updatedAt,
                  )}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
