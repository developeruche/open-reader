/** Document mode (PLAN.md §3.4.2, §8): the reader page wired to ReaderController. */
import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useStore } from 'zustand';
import type { SkipRules } from '@/core/text/skip';
import { REGISTRY } from '@/engines/factory';
import type { OutlineItem } from '@/pdf/viewer';
import { ReaderController } from '@/pdf/readerController';
import { fetchPdf, fileAccessAllowed, loadPdf } from '@/platform/documents';
import { IdbLibrary } from '@/platform/library';
import type { LibraryRow } from '@/platform/audioCache';
import { HIGHLIGHT_CSS } from '@/web/highlightCss';
import {
  ChevronLeft,
  ChevronRight,
  FileText,
  Library,
  PanelLeft,
  PanelRight,
  Search,
  Upload,
} from '../icons';
import {
  Button,
  Drawer,
  EmptyState,
  IconButton,
  Progress,
  Select,
  SkipLink,
  Tabs,
  Toggle,
  toast,
} from '../components';
import { FloatingTransport } from '../controls/FloatingTransport';

const ZOOMS = [
  { value: 'page-width', label: 'Fit width' },
  { value: 'page-fit', label: 'Fit page' },
  { value: '0.75', label: '75%' },
  { value: '1', label: '100%' },
  { value: '1.25', label: '125%' },
  { value: '1.5', label: '150%' },
  { value: '2', label: '200%' },
];

export function LiveReader() {
  const [ctl] = useState(() => new ReaderController());
  const s = useStore(ctl.store);
  const container = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const [left, setLeft] = useState(true);
  const [right, setRight] = useState(false);
  const [query, setQuery] = useState('');
  const [outline, setOutline] = useState<OutlineItem[]>([]);
  const [recent, setRecent] = useState<LibraryRow[]>([]);
  const [overlay, setOverlay] = useState(false);
  const [needsFileAccess, setNeedsFileAccess] = useState(false);

  useEffect(() => {
    if (container.current) ctl.attach(container.current);
    void new IdbLibrary().recent(20).then((r) => setRecent(r.filter((x) => x.kind === 'pdf')));
    const params = new URLSearchParams(location.search);
    const src = params.get('src');
    const doc = params.get('doc');
    void (async () => {
      try {
        if (doc) {
          const bytes = await loadPdf(doc);
          if (bytes) await ctl.openBytes(bytes, params.get('name') ?? 'Document.pdf');
          else
            toast({
              kind: 'error',
              title: 'This document is no longer stored. Open the file again.',
            });
        } else if (src) {
          if (src.startsWith('file:') && !(await fileAccessAllowed())) {
            setNeedsFileAccess(true);
            return;
          }
          await ctl.openBytes(
            await fetchPdf(src),
            decodeURIComponent(new URL(src).pathname.split('/').pop() || 'Document.pdf'),
          );
        }
      } catch (e) {
        toast({ kind: 'error', title: e instanceof Error ? e.message : String(e) });
      }
    })();
    return () => ctl.destroy();
  }, [ctl]);

  useEffect(() => {
    if (s.phase === 'ready') void ctl.view?.outline().then(setOutline);
  }, [s.phase, ctl]);

  useEffect(() => {
    if (s.notice) toast({ kind: 'info', title: s.notice });
  }, [s.notice]);

  const openFile = async (file: File) => {
    await ctl.openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
    history.replaceState(null, '', `?doc=${ctl.state.docId}&name=${encodeURIComponent(file.name)}`);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    const f = [...e.dataTransfer.files].find(
      (x) => x.type === 'application/pdf' || x.name.endsWith('.pdf'),
    );
    if (f) void openFile(f);
  };

  const setRule = (k: keyof SkipRules, skip: boolean) =>
    void ctl.setRules({ ...s.rules, [k]: skip ? 'skip' : 'read' });
  const playing = ['playing', 'buffering', 'preparing', 'seeking'].includes(s.state);
  const voices =
    (REGISTRY.models.find((m) => m.engine === s.engine) ?? REGISTRY.models[0])?.voices.map((v) => ({
      id: v.id,
      name: v.name,
      detail: v.lang,
    })) ?? [];

  return (
    <div
      className="flex h-screen flex-col bg-paper-2 text-ink"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <style>{HIGHLIGHT_CSS + '.textLayer ::highlight(or-word){color:#f6f4ef}'}</style>
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
        <h1 className="min-w-0 truncate text-sm font-medium">
          {s.title || s.fileName || 'Open Reader'}
        </h1>
        <div className="ml-auto flex items-center gap-1">
          <IconButton
            label="Previous page"
            size="sm"
            disabled={s.page <= 1}
            onClick={() => ctl.goToPage(s.page - 1)}
          >
            <ChevronLeft size={18} aria-hidden />
          </IconButton>
          <span className="text-[13px] tabular" aria-live="polite">
            Page {s.page} / {s.pages || '–'}
          </span>
          <IconButton
            label="Next page"
            size="sm"
            disabled={s.page >= s.pages}
            onClick={() => ctl.goToPage(s.page + 1)}
          >
            <ChevronRight size={18} aria-hidden />
          </IconButton>
          <span aria-hidden className="mx-1 h-5 w-px bg-line" />
          <Select
            label="Zoom"
            hideLabel
            value={s.scale}
            options={ZOOMS}
            onValueChange={(v) => {
              ctl.setScale(v);
              ctl.store.setState({ ...ctl.state, scale: v });
            }}
          />
          <span aria-hidden className="mx-1 h-5 w-px bg-line" />
          <form
            role="search"
            className="flex items-center gap-1"
            onSubmit={(e) => {
              e.preventDefault();
              ctl.view?.find(query, true);
            }}
          >
            <Search size={16} aria-hidden className="text-muted" />
            <input
              aria-label="Search in document"
              name="q"
              autoComplete="off"
              placeholder="Search…"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                ctl.view?.find(e.target.value);
              }}
              className="h-8 w-40 rounded-control border border-line bg-paper px-2 text-sm text-ink"
            />
          </form>
          <IconButton
            label={right ? 'Hide reading rules' : 'Show reading rules'}
            size="sm"
            aria-expanded={right}
            onClick={() => setRight(!right)}
          >
            <PanelRight size={18} aria-hidden />
          </IconButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Drawer
          side="left"
          open={left && s.phase === 'ready'}
          label="Pages and outline"
          width={232}
        >
          <Tabs
            label="Navigation"
            items={[
              {
                value: 'pages',
                label: 'Pages',
                content: <Thumbnails ctl={ctl} pages={s.pages} current={s.page} />,
              },
              {
                value: 'outline',
                label: 'Outline',
                content: outline.length ? (
                  <OutlineTree items={outline} onGo={(d) => ctl.view?.goTo(d)} />
                ) : (
                  <EmptyState title="No outline" body="This PDF has no bookmarks." />
                ),
              },
            ]}
          />
        </Drawer>

        <main id="content" tabIndex={-1} className="relative min-w-0 flex-1" aria-label="Document">
          <div
            ref={container}
            className="absolute inset-0 overflow-auto overscroll-contain"
            data-testid="viewer"
          >
            <div className="pdfViewer" />
          </div>
          {s.phase !== 'ready' ? (
            <div className="absolute inset-0 overflow-auto bg-paper">
              <div className="mx-auto max-w-xl px-6 py-16">
                {s.phase === 'loading' ? (
                  <div role="status">
                    <h2 className="font-serif text-2xl tracking-tight">Opening {s.fileName}…</h2>
                    <Progress
                      className="mt-6"
                      label="Analyzing pages"
                      value={s.progress ? s.progress.page / s.progress.total : null}
                    />
                    <p className="mt-2 text-[13px] text-muted tabular">
                      {s.progress
                        ? `Reading layout: page ${s.progress.page} of ${s.progress.total}`
                        : 'Loading…'}
                    </p>
                  </div>
                ) : needsFileAccess ? (
                  <EmptyState
                    icon={<FileText size={24} aria-hidden />}
                    title="Allow access to local files"
                    body="Chrome blocks extensions from opening files on your computer until you allow it: open chrome://extensions, choose Open Reader → Details, and turn on “Allow access to file URLs”. Then reload this page, or drop the PDF here."
                  />
                ) : (
                  <>
                    <EmptyState
                      icon={<Upload size={24} aria-hidden />}
                      title={s.phase === 'error' ? 'This PDF could not be opened' : 'Open a PDF'}
                      body={
                        s.error ??
                        'Drop a PDF anywhere on this page, or choose a file. It is stored on this computer so you can come back to it offline.'
                      }
                      action={
                        <>
                          <Button variant="primary" onClick={() => fileInput.current?.click()}>
                            Choose a PDF…
                          </Button>
                          <input
                            ref={fileInput}
                            type="file"
                            accept="application/pdf,.pdf"
                            className="sr-only"
                            aria-label="Choose a PDF"
                            onChange={(e) =>
                              e.target.files?.[0] && void openFile(e.target.files[0])
                            }
                          />
                        </>
                      }
                    />
                    {recent.length ? (
                      <section aria-labelledby="recent" className="px-6">
                        <h2
                          id="recent"
                          className="flex items-center gap-2 font-serif text-lg tracking-tight"
                        >
                          <Library size={18} aria-hidden /> Recent documents
                        </h2>
                        <ul className="mt-3 divide-y divide-line border-y border-line">
                          {recent.map((r) => (
                            <li key={r.docId}>
                              <a
                                className="flex items-center justify-between gap-4 py-3 text-sm hover:bg-hover"
                                href={`?doc=${r.docId}&name=${encodeURIComponent(r.title || 'Document')}.pdf`}
                              >
                                <span className="truncate">{r.title || 'Untitled PDF'}</span>
                                <span className="shrink-0 text-xs text-muted">
                                  {new Date(r.updatedAt).toLocaleDateString()}
                                </span>
                              </a>
                            </li>
                          ))}
                        </ul>
                      </section>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : null}
          {overlay && ctl.opened ? <ReadingOrderOverlay ctl={ctl} /> : null}
          {s.phase === 'ready' ? (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 flex justify-center">
              <div className="pointer-events-auto">
                <FloatingTransport
                  playing={playing}
                  sentence={s.sentence}
                  total={Math.max(1, s.sentences)}
                  rate={s.rate}
                  voice={s.voice}
                  voices={voices}
                  secondsLeft={secondsLeft(ctl, s.sentence, s.rate)}
                  follow={s.follow}
                  onToggle={() =>
                    ctl.send(s.state === 'error' ? { type: 'RETRY' } : { type: 'TOGGLE' })
                  }
                  onPrev={() => ctl.send({ type: 'PREV_SENTENCE' })}
                  onNext={() => ctl.send({ type: 'NEXT_SENTENCE' })}
                  onSeek={(i) => ctl.send({ type: 'SEEK', sentence: i })}
                  onRate={(rate) => ctl.send({ type: 'SET_SPEED', rate })}
                  onVoice={(voice) => ctl.send({ type: 'SET_VOICE', voice })}
                  onFollow={(f) => ctl.setFollow(f)}
                />
              </div>
            </div>
          ) : null}
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
                checked={s.rules.headersFooters === 'skip'}
                onCheckedChange={(v) => setRule('headersFooters', v)}
              />
              <Toggle
                label="Skip references"
                checked={s.rules.references === 'skip'}
                onCheckedChange={(v) => setRule('references', v)}
              />
              <Toggle
                label="Skip figure captions"
                checked={s.rules.captions === 'skip'}
                onCheckedChange={(v) => setRule('captions', v)}
              />
              <Toggle
                label="Show reading order"
                description="Numbers each block in the order it is read."
                checked={overlay}
                onCheckedChange={setOverlay}
              />
            </div>
            {s.emptyPages.length ? (
              <p className="mt-4 text-[13px] text-ink-2">
                <strong className="font-semibold">Note:</strong> {s.emptyPages.length} page
                {s.emptyPages.length > 1 ? 's have' : ' has'} no text layer (scanned). Text
                recognition arrives in a later version.
              </p>
            ) : null}
          </div>
        </Drawer>
      </div>
    </div>
  );
}

function secondsLeft(ctl: ReaderController, from: number, rate: number): number {
  let chars = 0;
  const nav = ctl.nav;
  if (!nav) return 0;
  for (let i = Math.max(0, from); i < nav.length; i++) {
    const s = nav.at(i)?.sentence;
    if (s) chars += s.end - s.start;
  }
  return (chars * 0.065) / Math.max(0.5, rate);
}

function Thumbnails({
  ctl,
  pages,
  current,
}: {
  ctl: ReaderController;
  pages: number;
  current: number;
}) {
  return (
    <ol className="flex flex-col items-center gap-4 p-4">
      {Array.from({ length: pages }, (_, i) => (
        <Thumb key={i} ctl={ctl} page={i + 1} current={current === i + 1} />
      ))}
    </ol>
  );
}

function Thumb({ ctl, page, current }: { ctl: ReaderController; page: number; current: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) {
        io.disconnect();
        void ctl.view?.thumbnail(page, el);
      }
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ctl, page]);
  return (
    <li>
      <button
        type="button"
        aria-label={`Page ${page}`}
        aria-current={current ? 'page' : undefined}
        onClick={() => ctl.goToPage(page)}
        className="block rounded-[2px] border border-line bg-paper aria-[current=page]:outline-2 aria-[current=page]:outline-offset-2 aria-[current=page]:outline-ink"
      >
        <canvas ref={canvas} width={112} height={145} className="block" aria-hidden />
      </button>
      <span className="mt-1 block text-center text-xs text-muted tabular">{page}</span>
    </li>
  );
}

function OutlineTree({
  items,
  onGo,
  depth = 0,
}: {
  items: OutlineItem[];
  onGo(dest: unknown): void;
  depth?: number;
}) {
  return (
    <ul className={depth ? '' : 'p-2'}>
      {items.map((it, i) => (
        <li key={`${depth}-${i}`}>
          <button
            type="button"
            onClick={() => onGo(it.dest)}
            className="w-full rounded-control px-3 py-2 text-left font-serif text-[15px] hover:bg-hover"
            style={{ paddingLeft: 12 + depth * 14 }}
          >
            {it.title}
          </button>
          {it.items?.length ? <OutlineTree items={it.items} onGo={onGo} depth={depth + 1} /> : null}
        </li>
      ))}
    </ul>
  );
}

/** Debug overlay: numbers each block where its first line sits (§8.3.8). */
function ReadingOrderOverlay({ ctl }: { ctl: ReaderController }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 500);
    return () => clearInterval(t);
  }, []);
  const opened = ctl.opened;
  if (!opened) return null;
  const firsts = new Map<number, (typeof opened.layout.order)[number]>();
  for (const o of opened.layout.order) if (!firsts.has(o.block)) firsts.set(o.block, o);
  return (
    <div aria-hidden data-tick={tick} className="pointer-events-none fixed inset-0 z-30">
      {[...firsts.values()].map((o) => {
        const div = ctl.view?.pageDiv(o.page);
        const page = opened.pages[o.page - 1];
        if (!div || !page) return null;
        const r = div.getBoundingClientRect();
        const scale = r.width / page.width;
        return (
          <span
            key={o.block}
            className="absolute rounded-full bg-ink px-1.5 text-[11px] text-paper tabular"
            style={{
              left: r.left + o.x0 * scale - 22,
              top: r.top + (page.height - o.y) * scale - 14,
            }}
          >
            {o.block + 1}
          </span>
        );
      })}
    </div>
  );
}
