/**
 * Web mode on the page (PLAN.md §7): extraction, highlights and cursor driven by a local clock,
 * follow-scroll, click-to-read, "Play from here", the mini player, in-page keys and SPA recovery.
 */
import { createElement } from 'react';
import type { Root } from 'react-dom/client';
import type { Block } from '@/core/document/model';
import { ClockFollower, type SyncEvent } from '@/core/player/sync';
import type {
  ContentMessage,
  ContentSession,
  ContentUpdate,
  TextPoint,
  UiCommand,
} from '@/runtime/protocol';
import { MiniPlayer, mountMiniPlayer } from '@/ui/shells/MiniPlayer';
import { variantFor } from './contrast';
import { CursorOverlay } from './cursor';
import { extractPage, extractSelection, locate, rangeFor, type Extraction } from './extract';
import { FollowScroller } from './follow';
import { HighlightPainter } from './painter';

const RATES = [0.75, 1, 1.25, 1.5, 2, 2.5, 3];

export class ContentApp {
  extraction: Extraction | undefined;
  session: ContentSession = { active: false, docId: null, state: null, rate: 1 };
  readonly follower = new ClockFollower();
  readonly painter = new HighlightPainter();
  readonly follow: FollowScroller;
  private cursor: CursorOverlay | undefined;
  private block: Block | undefined;
  private sentenceRange: Range | undefined;
  private lastWord = -2;
  private raf = 0;
  private contextPoint: { x: number; y: number } | undefined;
  private mini: { root: Root; host: HTMLElement } | undefined;
  private playHere: HTMLElement | undefined;
  private observer: MutationObserver | undefined;
  private remapTimer: ReturnType<typeof setTimeout> | undefined;
  /** Highlights on the page stopped after an SPA re-render we could not follow. */
  pageHighlightLost = false;

  constructor(
    private readonly post: (m: ContentMessage) => void,
    private readonly doc: Document = document,
  ) {
    this.follow = new FollowScroller(doc.defaultView ?? window);
    this.follow.onSuspendChange(() => this.renderMini());
    doc.addEventListener(
      'contextmenu',
      (e) => (this.contextPoint = { x: e.clientX, y: e.clientY }),
      true,
    );
    doc.addEventListener('click', (e) => this.onClick(e), true);
    doc.addEventListener('keydown', (e) => this.onKey(e), true);
    doc.addEventListener('mouseup', () => setTimeout(() => this.updatePlayHere(), 0), true);
    const view = doc.defaultView ?? window;
    view.addEventListener('scroll', () => this.cursor?.show(this.wordRange()), { passive: true });
    view.addEventListener('resize', () => this.cursor?.show(this.wordRange()));
  }

  // ── messages from the background ──────────────────────────────────────────

  handle(msg: ContentUpdate): void {
    switch (msg.type) {
      case 'EXTRACT':
        this.extract(msg.fromSelection, msg.fromHere ?? false);
        break;
      case 'SESSION':
        this.onSession(msg.session);
        break;
      case 'SYNC':
        this.onSync(msg.event);
        break;
    }
  }

  private extract(fromSelection: boolean, fromHere: boolean): void {
    const sel = this.doc.getSelection();
    const url = this.doc.location.href;
    if (fromSelection && sel && !sel.isCollapsed && sel.rangeCount) {
      this.setExtraction(extractSelection(this.doc, sel.getRangeAt(0), url));
      if (this.extraction?.doc.blocks.length)
        this.post({
          type: 'DOC',
          doc: this.extraction.doc,
          url,
          startAt: { blockId: this.extraction.doc.blocks[0]?.id ?? 'b0', offset: 0 },
        });
      else this.post({ type: 'NO_CONTENT', url });
      return;
    }
    this.setExtraction(extractPage(this.doc, url));
    const x = this.extraction;
    if (!x?.doc.blocks.length) return this.post({ type: 'NO_CONTENT', url });
    const startAt = fromHere ? (this.pointAt(this.contextPoint) ?? this.firstVisible()) : undefined;
    this.post({ type: 'DOC', doc: x.doc, url, startAt });
  }

  private setExtraction(x: Extraction): void {
    this.extraction = x;
    this.pageHighlightLost = false;
    this.watchMutations();
  }

  private onSession(s: ContentSession): void {
    const wasActive = this.session.active;
    this.session = s;
    const mine = s.active && !!this.extraction && s.docId === this.extraction.doc.id;
    if (!mine) {
      if (wasActive) this.stopPainting();
      this.unmountMini();
      return;
    }
    this.mountMini();
    if (s.state === 'playing') this.loop();
    else cancelAnimationFrame(this.raf);
  }

  private onSync(e: SyncEvent): void {
    this.follower.apply(e);
    const x = this.extraction;
    if (!x) return;
    if (e.type === 'SEGMENT_STARTED') {
      this.block = x.doc.blocks.find((b) => b.id === e.blockId);
      const s = this.block?.sentences.find((q) => q.id === e.sentenceId);
      this.sentenceRange =
        this.block && s ? rangeFor(this.block, x.registry, s.start, s.end) : undefined;
      this.lastWord = -2;
      const anchor = this.sentenceRange?.startContainer.parentElement ?? null;
      const variant = variantFor(anchor, this.doc.defaultView ?? window);
      this.painter.setVariant(variant);
      this.cursor ??= new CursorOverlay(this.doc);
      this.cursor.setVariant(variant);
      if (!this.pageHighlightLost) {
        this.painter.paint(this.sentenceRange, undefined);
        this.follow.follow(this.sentenceRange?.getBoundingClientRect());
      }
      this.loop();
    }
    if (e.type === 'PAUSED' || e.type === 'SEEKED') cancelAnimationFrame(this.raf);
    if (e.type === 'RESUMED' || e.type === 'RATE_CHANGED' || e.type === 'DRIFT') this.loop();
  }

  // ── painting ──────────────────────────────────────────────────────────────

  private currentWordIndex = -1;

  private wordRange(): Range | undefined {
    const seg = this.follower.segment;
    const w = seg?.words[this.currentWordIndex];
    if (!w || !this.block || !this.extraction) return undefined;
    return rangeFor(this.block, this.extraction.registry, w.displayStart, w.displayEnd);
  }

  private loop(): void {
    cancelAnimationFrame(this.raf);
    const tick = () => {
      if (this.follower.paused) return;
      const i = this.follower.wordIndex(Date.now());
      if (i !== this.lastWord) {
        this.lastWord = i;
        this.currentWordIndex = i;
        if (!this.pageHighlightLost) {
          const word = this.wordRange();
          this.painter.paint(this.sentenceRange, word);
          this.cursor?.show(word);
        }
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  private stopPainting(): void {
    cancelAnimationFrame(this.raf);
    this.painter.clear();
    this.cursor?.hide();
  }

  // ── click-to-read and "Play from here" ────────────────────────────────────

  private pointAt(p: { x: number; y: number } | undefined): TextPoint | undefined {
    const x = this.extraction;
    if (!p || !x) return undefined;
    const pos = (
      this.doc as Document & {
        caretPositionFromPoint?(x: number, y: number): { offsetNode: Node; offset: number } | null;
      }
    ).caretPositionFromPoint?.(p.x, p.y);
    if (!pos) return undefined;
    const loc = locate(x.doc, x.registry, pos.offsetNode, pos.offset);
    return loc ? { blockId: loc.blockId, offset: loc.offset } : undefined;
  }

  /** The first block whose text is visible in the viewport ("Read page from here" fallback). */
  private firstVisible(): TextPoint | undefined {
    const x = this.extraction;
    if (!x) return undefined;
    const h = (this.doc.defaultView ?? window).innerHeight;
    for (const b of x.doc.blocks) {
      const r = rangeFor(b, x.registry, 0, b.text.length)?.getBoundingClientRect();
      if (r && r.bottom > 0 && r.top < h) return { blockId: b.id, offset: 0 };
    }
    return undefined;
  }

  private readFrom(at: TextPoint): void {
    const x = this.extraction;
    if (!x) return;
    if (this.session.active && this.session.docId === x.doc.id)
      this.post({ type: 'SEEK', docId: x.doc.id, at });
    else this.post({ type: 'DOC', doc: x.doc, url: this.doc.location.href, startAt: at });
  }

  private onClick(e: MouseEvent): void {
    if (!e.altKey) return;
    if (!this.extraction) this.setExtraction(extractPage(this.doc, this.doc.location.href));
    const at = this.pointAt({ x: e.clientX, y: e.clientY });
    if (!at) return;
    e.preventDefault();
    e.stopPropagation();
    this.readFrom(at);
  }

  private updatePlayHere(): void {
    const sel = this.doc.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount || !sel.toString().trim())
      return this.hidePlayHere();
    const range = sel.getRangeAt(0);
    const rect = [...range.getClientRects()].at(-1);
    if (!rect) return this.hidePlayHere();
    if (!this.playHere) {
      const host = this.doc.createElement('open-reader-play-here');
      const shadow = host.attachShadow({ mode: 'closed' });
      const button = this.doc.createElement('button');
      button.type = 'button';
      button.textContent = 'Play from here';
      button.setAttribute('aria-label', 'Play from here');
      const style = this.doc.createElement('style');
      style.textContent = `button{all:unset;font:500 13px/1 ui-sans-serif,system-ui;background:#0b0b0b;color:#f6f4ef;padding:8px 12px;border-radius:999px;box-shadow:0 1px 2px rgba(0,0,0,.08),0 8px 24px rgba(0,0,0,.06);cursor:default}button:focus-visible{outline:2px solid #0b0b0b;outline-offset:2px}`;
      button.addEventListener('mousedown', (ev) => ev.preventDefault());
      button.addEventListener('click', () => {
        const s = this.doc.getSelection();
        if (!this.extraction) this.setExtraction(extractPage(this.doc, this.doc.location.href));
        const x = this.extraction;
        const node = s?.rangeCount ? s.getRangeAt(0).startContainer : undefined;
        const loc =
          x && node
            ? locate(x.doc, x.registry, node, s?.getRangeAt(0).startOffset ?? 0)
            : undefined;
        this.hidePlayHere();
        if (loc) this.readFrom({ blockId: loc.blockId, offset: loc.offset });
      });
      shadow.append(style, button);
      Object.assign(host.style, { position: 'fixed', zIndex: '2147483646' });
      this.doc.documentElement.append(host);
      this.playHere = host;
    }
    Object.assign(this.playHere.style, {
      left: `${Math.round(rect.right + 8)}px`,
      top: `${Math.round(rect.bottom + 6)}px`,
      display: 'block',
    });
  }

  private hidePlayHere(): void {
    if (this.playHere) this.playHere.style.display = 'none';
  }

  // ── keyboard (§7.3) ───────────────────────────────────────────────────────

  private onKey(e: KeyboardEvent): void {
    const x = this.extraction;
    if (!this.session.active || !x || this.session.docId !== x.doc.id) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName))) return;
    let cmd: UiCommand | undefined;
    switch (e.key) {
      case ' ':
        cmd = { type: 'TOGGLE' };
        break;
      case 'j':
        cmd = { type: 'PREV_SENTENCE' };
        break;
      case 'k':
        cmd = { type: 'NEXT_SENTENCE' };
        break;
      case 'J':
        cmd = { type: 'PREV_BLOCK' };
        break;
      case 'K':
        cmd = { type: 'NEXT_BLOCK' };
        break;
      case '-':
        cmd = { type: 'SET_SPEED', rate: Math.max(0.5, +(this.session.rate - 0.25).toFixed(2)) };
        break;
      case '=':
        cmd = { type: 'SET_SPEED', rate: Math.min(4, +(this.session.rate + 0.25).toFixed(2)) };
        break;
      case 'f':
        this.follow.enabled = !this.follow.enabled;
        if (this.follow.enabled) this.follow.resume();
        this.renderMini();
        break;
      case 'Escape':
        cmd = { type: 'STOP' };
        break;
      default:
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (cmd) this.post({ type: 'COMMAND', command: cmd });
  }

  // ── mini player ───────────────────────────────────────────────────────────

  private mountMini(): void {
    if (!this.mini) {
      this.mini = mountMiniPlayer(this.doc);
    }
    this.renderMini();
  }

  private renderMini(): void {
    const m = this.mini;
    if (!m) return;
    const s = this.session;
    m.root.render(
      createElement(MiniPlayer, {
        playing:
          s.state === 'playing' ||
          s.state === 'buffering' ||
          s.state === 'preparing' ||
          s.state === 'seeking',
        rate: s.rate,
        followSuspended: this.follow.suspended || !this.follow.enabled,
        onToggle: () => this.post({ type: 'COMMAND', command: { type: 'TOGGLE' } }),
        onRate: () =>
          this.post({
            type: 'COMMAND',
            command: {
              type: 'SET_SPEED',
              rate: RATES[(RATES.indexOf(s.rate) + 1) % RATES.length] ?? 1,
            },
          }),
        onJump: () => {
          this.follow.enabled = true;
          this.follow.resume();
          this.follow.follow(this.sentenceRange?.getBoundingClientRect());
          this.renderMini();
        },
      }),
    );
  }

  private unmountMini(): void {
    this.mini?.root.unmount();
    this.mini?.host.remove();
    this.mini = undefined;
  }

  // ── SPA re-renders (§7.1.7) ───────────────────────────────────────────────

  private watchMutations(): void {
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => {
      if (this.remapTimer) clearTimeout(this.remapTimer);
      this.remapTimer = setTimeout(() => this.remapIfNeeded(), 250);
    });
    this.observer.observe(this.doc.body ?? this.doc.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  /** Re-maps blocks to new nodes after a re-render; falls back to side-panel-only highlights. */
  remapIfNeeded(): boolean {
    const x = this.extraction;
    if (!x || x.registry.allConnected() || x.mode === 'selection') return true;
    const fresh = extractPage(this.doc, this.doc.location.href);
    const same =
      fresh.doc.blocks.length === x.doc.blocks.length &&
      fresh.doc.blocks.every((b, i) => b.text === x.doc.blocks[i]?.text);
    if (same) {
      this.extraction = {
        ...x,
        registry: fresh.registry,
        doc: {
          ...x.doc,
          blocks: x.doc.blocks.map((b, i) => ({
            ...b,
            anchors: fresh.doc.blocks[i]?.anchors ?? [],
          })),
        },
      };
      if (this.block) {
        this.block = this.extraction.doc.blocks.find((b) => b.id === this.block?.id);
        const s = this.block?.sentences.find((q) => q.id === this.follower.segment?.sentenceId);
        this.sentenceRange =
          this.block && s ? rangeFor(this.block, fresh.registry, s.start, s.end) : undefined;
        this.lastWord = -2;
      }
      return true;
    }
    if (!this.pageHighlightLost) {
      this.pageHighlightLost = true;
      this.painter.clear();
      this.cursor?.hide();
      this.post({
        type: 'NOTE',
        message:
          'The page changed while reading. Reading continues; follow along in the side panel.',
      });
    }
    return false;
  }
}
