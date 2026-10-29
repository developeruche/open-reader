/**
 * Document mode controller (PLAN.md §8): opens and stores PDFs, analyzes layout, runs the in-page
 * engine host, paints sentence/word highlights across pages, follows the voice through the
 * document, and handles click-to-read and reading rules. The React reader page is a thin view.
 */
import { createStore } from 'zustand/vanilla';
import type { ReadingDocument } from '@/core/document/model';
import { Navigator } from '@/core/document/positions';
import type { InstalledIndex } from '@/core/models/manager';
import { INSTALLED_KEY } from '@/core/models/manager';
import type { PlayerEvent, PlayerStateValue } from '@/core/player/machine';
import { ClockFollower, type SyncEvent } from '@/core/player/sync';
import { applySkipRules, DEFAULT_SKIP_RULES, type SkipRules } from '@/core/text/skip';
import { savePdf } from '@/platform/documents';
import { localStore } from '@/platform/kv';
import { IdbLibrary } from '@/platform/library';
import { loadSettings } from '@/platform/settings';
import { createInPageHost, type InPageHost } from '@/runtime/inpageHost';
import type { HostEvent } from '@/runtime/protocol';
import { sessionSettingsFrom } from '@/runtime/sessionSettings';
import { CursorOverlay } from '@/web/cursor';
import { FollowScroller } from '@/web/follow';
import { HighlightPainter } from '@/web/painter';
import { blockAt, TextLayerMap } from './textLayerMap';
import { PdfView, type OpenedPdf } from './viewer';

export interface ReaderState {
  phase: 'empty' | 'loading' | 'ready' | 'error';
  progress: { page: number; total: number } | null;
  title: string;
  fileName: string;
  docId: string | null;
  page: number;
  pages: number;
  scale: string;
  state: PlayerStateValue;
  sentence: number;
  sentences: number;
  rate: number;
  voice: string;
  engine: string;
  backend: string;
  follow: boolean;
  rules: SkipRules;
  error: string | null;
  notice: string | null;
  firstPageMs: number;
  layoutMs: number;
  /** Pages without text (need OCR). */
  emptyPages: number[];
}

const INITIAL: ReaderState = {
  phase: 'empty',
  progress: null,
  title: '',
  fileName: '',
  docId: null,
  page: 1,
  pages: 0,
  scale: 'page-width',
  state: 'idle',
  sentence: 0,
  sentences: 0,
  rate: 1,
  voice: '',
  engine: '',
  backend: '',
  follow: true,
  rules: DEFAULT_SKIP_RULES,
  error: null,
  notice: null,
  firstPageMs: 0,
  layoutMs: 0,
  emptyPages: [],
};

export class ReaderController {
  readonly store = createStore<ReaderState>(() => INITIAL);
  view: PdfView | undefined;
  host: InPageHost | undefined;
  opened: OpenedPdf | undefined;
  doc: ReadingDocument | undefined;
  nav: Navigator | undefined;
  private map: TextLayerMap | undefined;
  private readonly painter = new HighlightPainter();
  private cursor: CursorOverlay | undefined;
  private follow: FollowScroller | undefined;
  private readonly follower = new ClockFollower();
  private raf = 0;
  private lastWord = -2;
  private segment: { blockId: string; sentenceId: string } | undefined;
  private readonly library = new IdbLibrary();
  private down: { x: number; y: number } | undefined;

  attach(container: HTMLDivElement): void {
    if (this.view) return;
    this.view = new PdfView(container);
    this.follow = new FollowScroller(
      window,
      () => matchMedia('(prefers-reduced-motion: reduce)').matches,
      container,
    );
    this.follow.onSuspendChange(() => this.set({}));
    this.view.on('pagechanging', (e) => this.set({ page: e.pageNumber ?? 1 }));
    this.view.on('textlayerrendered', (e) => {
      if (e.pageNumber) this.map?.invalidate(e.pageNumber);
      this.repaint();
    });
    this.view.on('scalechanging', () => this.repaint());
    container.addEventListener('scroll', () => this.cursor?.show(this.painter.word), {
      passive: true,
    });
    container.addEventListener('pointerdown', (e) => (this.down = { x: e.clientX, y: e.clientY }));
    container.addEventListener('click', (e) => this.onClick(e));
  }

  get state(): ReaderState {
    return this.store.getState();
  }

  private set(p: Partial<ReaderState>): void {
    this.store.setState({ ...this.store.getState(), ...p, follow: this.follow?.enabled ?? true });
    if (import.meta.env.MODE === 'test')
      document.documentElement.dataset.orState = this.store.getState().state;
  }

  // ── opening ───────────────────────────────────────────────────────────────

  async openBytes(bytes: Uint8Array, fileName: string): Promise<void> {
    if (!this.view) throw new Error('attach() first');
    this.set({ phase: 'loading', fileName, progress: null, error: null });
    try {
      const id = await savePdf(bytes);
      const opened = await this.view.open(bytes, id, fileName, (page, total) =>
        this.set({ progress: { page, total } }),
      );
      this.opened = opened;
      this.map = new TextLayerMap(opened.pages, (p) => this.view?.pageDiv(p));
      const settings = await loadSettings();
      this.set({
        phase: 'ready',
        title: opened.doc.title,
        docId: id,
        pages: opened.pdf.numPages,
        firstPageMs: Math.round(opened.firstPageMs),
        layoutMs: Math.round(opened.layoutMs),
        emptyPages: opened.layout.emptyPages,
        rules: settings.skipRules,
      });
      const saved = await this.library.getPosition(id);
      await this.load(settings.skipRules, saved ? undefined : 0, saved);
      // Opened documents join the library right away, so they can be reopened offline.
      const first = this.nav?.position(this.state.sentence, 0);
      if (first)
        await this.library.savePosition(saved ?? first, { title: opened.doc.title, kind: 'pdf' });
      if (import.meta.env.MODE === 'test') Object.assign(window, { __reader: this });
    } catch (e) {
      this.set({ phase: 'error', error: e instanceof Error ? e.message : String(e) });
    }
  }

  /** (Re)loads the player with reading rules applied, at a sentence or a saved position. */
  private async load(
    rules: SkipRules,
    sentence?: number,
    saved?: { sentenceId: string; word: number; docId: string; updatedAt: number },
  ): Promise<void> {
    const opened = this.opened;
    if (!opened) return;
    this.doc = { ...opened.doc, blocks: applySkipRules(opened.doc.blocks, rules) };
    this.nav = new Navigator(this.doc, { announceSkippedCode: rules.announceSkippedCode });
    const start = saved ? this.nav.resolve(saved) : { index: sentence ?? 0, word: 0 };
    this.host ??= createInPageHost((e) => this.onHost(e));
    const installed = (await localStore().get<InstalledIndex>(INSTALLED_KEY)) ?? {};
    const session = sessionSettingsFrom(
      await loadSettings(),
      installed,
      import.meta.env.MODE === 'test',
    );
    await this.host.load(this.doc, {
      start: start.index,
      settings: { ...session, skipRules: rules },
      autoplay: false,
    });
    this.set({ sentences: this.nav.length, sentence: start.index, rules });
    if (saved) this.scrollToSentence(start.index);
  }

  async setRules(rules: SkipRules): Promise<void> {
    const at = this.nav?.at(this.state.sentence);
    const wasPlaying = this.state.state === 'playing';
    await this.load(rules);
    const i = at ? this.nav?.sentenceAtOffset(at.block.id, at.sentence.start) : undefined;
    if (i !== undefined) this.send({ type: 'SEEK', sentence: i });
    if (wasPlaying) this.send({ type: 'PLAY' });
  }

  // ── transport ─────────────────────────────────────────────────────────────

  send(e: PlayerEvent): void {
    const h = this.host;
    // Through the runtime, so an engine released while idle is reloaded first (ADR 0017).
    if (h) void h.runtime.handle({ type: 'PLAYER', sessionId: h.sessionId, event: e });
  }

  goToPage(n: number): void {
    if (this.view) this.view.page = n;
  }

  setScale(v: string): void {
    if (this.view) this.view.scale = v;
  }

  setFollow(on: boolean): void {
    if (!this.follow) return;
    this.follow.enabled = on;
    if (on) {
      this.follow.resume();
      this.followCurrent();
    }
    this.set({});
  }

  get followSuspended(): boolean {
    return !!this.follow?.suspended;
  }

  // ── host events ───────────────────────────────────────────────────────────

  private onHost(e: HostEvent): void {
    if (e.type === 'STATUS') {
      this.set({
        state: e.status.state,
        sentence: e.status.cursor.sentence,
        rate: e.status.rate,
        voice: e.status.voice,
        engine: e.status.engine ?? '',
        backend: e.status.backend ?? '',
        error: e.status.error,
      });
    } else if (e.type === 'SYNC') this.onSync(e.event);
    else if (e.type === 'POSITION')
      void this.library.savePosition(e.position, { title: this.state.title, kind: 'pdf' });
    else if (e.type === 'NOTICE') this.set({ notice: e.notice.message });
  }

  private onSync(e: SyncEvent): void {
    this.follower.apply(e);
    if (e.type === 'SEGMENT_STARTED') {
      this.segment = { blockId: e.blockId, sentenceId: e.sentenceId };
      this.lastWord = -2;
      this.followCurrent();
      this.repaint();
      this.loop();
    }
    if (e.type === 'RESUMED' || e.type === 'RATE_CHANGED' || e.type === 'DRIFT') this.loop();
  }

  private block() {
    return this.doc?.blocks.find((b) => b.id === this.segment?.blockId);
  }

  private sentenceRanges() {
    const b = this.block();
    const s = b?.sentences.find((q) => q.id === this.segment?.sentenceId);
    return b && s && this.map ? this.map.ranges(b, s.start, s.end) : { ranges: [], pages: [] };
  }

  private wordRange(): Range | undefined {
    const seg = this.follower.segment;
    const w = seg?.words[this.follower.wordIndex(Date.now())];
    const b = this.block();
    return w && b && this.map
      ? this.map.ranges(b, w.displayStart, w.displayEnd).ranges[0]
      : undefined;
  }

  private repaint(): void {
    const word = this.wordRange();
    this.painter.paint(this.sentenceRanges().ranges, word);
    this.cursor ??= new CursorOverlay(document);
    this.cursor.show(word);
    if (import.meta.env.MODE === 'test') this.exposeForTests(word);
  }

  private loop(): void {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (this.follower.paused) return;
      const i = this.follower.wordIndex(Date.now());
      if (i !== this.lastWord) {
        this.lastWord = i;
        this.repaint();
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  /** Follow-scroll across pages: render the sentence's page first if needed (§8.4). */
  private followCurrent(): void {
    if (!this.follow?.enabled || this.follow.suspended) return;
    const { ranges, pages } = this.sentenceRanges();
    if (ranges[0]) this.follow.follow(ranges[0].getBoundingClientRect());
    else if (pages[0] && this.view) this.view.page = pages[0];
  }

  private scrollToSentence(i: number): void {
    const s = this.nav?.at(i);
    const a = s?.block.anchors[0]?.anchor;
    if (a?.kind === 'pdf' && this.view) this.view.page = a.page;
  }

  // ── click-to-read (§8.3.8) ─────────────────────────────────────────────────

  private onClick(e: MouseEvent): void {
    const moved = this.down
      ? Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 4
      : false;
    if (moved || !getSelection()?.isCollapsed || !this.doc || !this.nav || !this.map) return;
    const pos = document.caretPositionFromPoint(e.clientX, e.clientY);
    if (!pos) return;
    const at = this.map.locateNode(pos.offsetNode, pos.offset);
    const loc = at && blockAt(this.doc, at);
    const i = loc && this.nav.sentenceAtOffset(loc.blockId, loc.offset);
    if (i === undefined || !loc) return;
    this.send({ type: 'SEEK', sentence: i, word: this.nav.wordAtOffset(i, loc.offset) });
    if (this.state.state !== 'playing') this.send({ type: 'PLAY' });
  }

  private exposeForTests(word: Range | undefined): void {
    const el = document.documentElement;
    el.dataset.orWord = word?.toString() ?? '';
    el.dataset.orSentence = this.sentenceRanges()
      .ranges.map((r) => r.toString())
      .join(' ');
    const pageEl = word?.startContainer.parentElement?.closest<HTMLElement>('[data-page-number]');
    el.dataset.orWordPage = pageEl?.dataset.pageNumber ?? '';
    if (pageEl && word) {
      const r = word.getBoundingClientRect();
      const p = pageEl.getBoundingClientRect();
      el.dataset.orWordX = ((r.left - p.left) / p.width).toFixed(3);
    }
  }

  destroy(): void {
    cancelAnimationFrame(this.raf);
    this.painter.clear();
    this.cursor?.destroy();
    this.follow?.destroy();
    this.view?.destroy();
  }
}
