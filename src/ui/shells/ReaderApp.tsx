import { useCallback, useState } from 'react';
import {
  ChevronLeft,
  ChevronRight,
  PanelLeft,
  PanelRight,
  Search,
  Settings,
  ZoomIn,
  ZoomOut,
} from '../icons';
import { Drawer, IconButton, SkipLink, Tabs, Toggle } from '../components';
import { FloatingTransport } from '../controls/FloatingTransport';
import { MOCK_DOC, MOCK_SENTENCES } from '../mock/mockDocument';
import { mockTimeLeft, useMockPlayer } from '../mock/mockPlayer';
import { ReadingView } from '../reading/ReadingView';
import { useTransportKeys } from './useTransportKeys';

const PAGES = 3;
const ZOOMS = [0.75, 1, 1.25, 1.5];

function stepZoom(zoom: number, dir: 1 | -1): number {
  const i = Math.max(0, Math.min(ZOOMS.length - 1, ZOOMS.indexOf(zoom) + dir));
  return ZOOMS[i] ?? zoom;
}

export function ReaderApp() {
  const p = useMockPlayer();
  useTransportKeys();
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [page, setPage] = useState(1);
  const [rules, setRules] = useState({ headers: true, references: true, captions: false });
  const onSeek = useCallback((i: number) => useMockPlayer.getState().seek(i), []);

  return (
    <div className="flex h-screen flex-col bg-paper-2 text-ink">
      <SkipLink />
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line bg-paper px-3">
        <IconButton
          label={left ? 'Hide pages and outline' : 'Show pages and outline'}
          size="sm"
          aria-expanded={left}
          onClick={() => setLeft(!left)}
        >
          <PanelLeft size={18} aria-hidden />
        </IconButton>
        <h1 className="min-w-0 truncate text-sm font-medium">psbt-deep-dive.pdf</h1>
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label="Previous page"
            size="sm"
            onClick={() => setPage(Math.max(1, page - 1))}
          >
            <ChevronLeft size={18} aria-hidden />
          </IconButton>
          <span className="text-[13px] tabular" aria-live="polite">
            Page {page} / {PAGES}
          </span>
          <IconButton
            label="Next page"
            size="sm"
            onClick={() => setPage(Math.min(PAGES, page + 1))}
          >
            <ChevronRight size={18} aria-hidden />
          </IconButton>
          <span aria-hidden className="mx-1 h-5 w-px bg-line" />
          <IconButton label="Zoom out" size="sm" onClick={() => setZoom(stepZoom(zoom, -1))}>
            <ZoomOut size={18} aria-hidden />
          </IconButton>
          <span className="w-12 text-center text-[13px] tabular">{Math.round(zoom * 100)}%</span>
          <IconButton label="Zoom in" size="sm" onClick={() => setZoom(stepZoom(zoom, 1))}>
            <ZoomIn size={18} aria-hidden />
          </IconButton>
          <span aria-hidden className="mx-1 h-5 w-px bg-line" />
          <IconButton label="Search" size="sm" shortcut="⌘F">
            <Search size={18} aria-hidden />
          </IconButton>
          <IconButton
            label={right ? 'Hide reading rules' : 'Show reading rules'}
            size="sm"
            aria-expanded={right}
            onClick={() => setRight(!right)}
          >
            <PanelRight size={18} aria-hidden />
          </IconButton>
          <IconButton label="Settings" size="sm">
            <Settings size={18} aria-hidden />
          </IconButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Drawer side="left" open={left} label="Pages and outline" width={232}>
          <Tabs
            label="Navigation"
            items={[
              {
                value: 'pages',
                label: 'Pages',
                content: (
                  <ol className="flex flex-col items-center gap-4 p-4">
                    {Array.from({ length: PAGES }, (_, i) => (
                      <li key={i}>
                        <button
                          type="button"
                          aria-label={`Page ${i + 1}`}
                          aria-current={page === i + 1 ? 'page' : undefined}
                          onClick={() => setPage(i + 1)}
                          className="block h-36 w-28 rounded-[2px] border border-line bg-paper p-2 aria-[current=page]:outline-2 aria-[current=page]:outline-offset-2 aria-[current=page]:outline-ink"
                        >
                          {Array.from({ length: 9 }, (_, k) => (
                            <span
                              key={k}
                              aria-hidden
                              className="mb-1.5 block h-1 rounded-full bg-line"
                              style={{ width: `${60 + ((k * 37 + i * 11) % 40)}%` }}
                            />
                          ))}
                        </button>
                        <span className="mt-1 block text-center text-xs text-muted tabular">
                          {i + 1}
                        </span>
                      </li>
                    ))}
                  </ol>
                ),
              },
              {
                value: 'outline',
                label: 'Outline',
                content: (
                  <ul className="p-2">
                    {MOCK_DOC.blocks
                      .filter((b) => b.type === 'heading')
                      .map((b) => (
                        <li key={b.id}>
                          <button
                            type="button"
                            className="w-full rounded-control px-3 py-2 text-left font-serif text-[15px] hover:bg-hover"
                          >
                            {b.sentences[0]?.text}
                          </button>
                        </li>
                      ))}
                  </ul>
                ),
              },
            ]}
          />
        </Drawer>

        <main
          id="content"
          tabIndex={-1}
          className="relative min-w-0 flex-1 overflow-auto overscroll-contain"
          aria-label="Document"
        >
          <div className="flex flex-col items-center gap-6 px-6 pt-8 pb-32" style={{ zoom }}>
            {Array.from({ length: PAGES }, (_, i) => (
              <div
                key={i}
                className="w-[min(100%,720px)] rounded-[2px] border border-line bg-paper px-14 py-12"
                aria-label={`Page ${i + 1}`}
                role="region"
              >
                {i === 0 ? (
                  <ReadingView
                    blocks={MOCK_DOC.blocks}
                    sentence={p.sentence}
                    word={p.word}
                    active={p.status !== 'idle'}
                    follow={p.follow}
                    onSeek={onSeek}
                  />
                ) : (
                  <div aria-hidden className="space-y-2.5">
                    {Array.from({ length: 22 }, (_, k) => (
                      <span
                        key={k}
                        className="block h-2 rounded-full bg-paper-2"
                        style={{ width: `${70 + ((k * 29 + i * 13) % 30)}%` }}
                      />
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="pointer-events-none fixed inset-x-0 bottom-6 flex justify-center">
            <div className="pointer-events-auto">
              <FloatingTransport
                playing={p.status === 'playing'}
                sentence={p.sentence}
                total={MOCK_SENTENCES.length}
                rate={p.rate}
                voice={p.voice}
                secondsLeft={mockTimeLeft(p.sentence, p.word, p.rate)}
                follow={p.follow}
                onToggle={p.toggle}
                onPrev={p.prev}
                onNext={p.next}
                onSeek={p.seek}
                onRate={p.setRate}
                onVoice={p.setVoice}
                onFollow={p.setFollow}
              />
            </div>
          </div>
        </main>

        <Drawer side="right" open={right} label="Reading rules" width={300}>
          <div className="p-4">
            <h2 className="font-serif text-lg tracking-tight">Reading rules</h2>
            <p className="mt-1 text-[13px] text-muted">
              Skipped text stays visible; the voice passes over it.
            </p>
            <div className="mt-3 divide-y divide-line">
              <Toggle
                label="Skip headers and footers"
                checked={rules.headers}
                onCheckedChange={(v) => setRules({ ...rules, headers: v })}
              />
              <Toggle
                label="Skip references"
                checked={rules.references}
                onCheckedChange={(v) => setRules({ ...rules, references: v })}
              />
              <Toggle
                label="Skip figure captions"
                checked={rules.captions}
                onCheckedChange={(v) => setRules({ ...rules, captions: v })}
              />
            </div>
          </div>
        </Drawer>
      </div>
    </div>
  );
}
