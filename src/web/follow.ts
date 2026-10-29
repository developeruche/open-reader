/**
 * Follow-scroll (§7.3): keeps the current sentence inside 25–65% of the viewport height. Any user
 * scroll, wheel, touch or scroll key suspends following for 5 seconds.
 */
export const BAND = { top: 0.25, bottom: 0.65, target: 0.35 } as const;
export const SUSPEND_MS = 5000;

export class FollowScroller {
  enabled = true;
  private suspendedUntil = 0;
  private programmaticUntil = 0;
  private readonly listeners = new Set<(suspended: boolean) => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private readonly onUser = () => this.userScrolled();
  private readonly onScroll = () => {
    if (performance.now() > this.programmaticUntil) this.userScrolled();
  };
  private readonly onKey = (e: KeyboardEvent) => {
    if (['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown'].includes(e.key))
      this.userScrolled();
  };

  private readonly target: Window | HTMLElement;

  /** `scroller`: an element that scrolls instead of the window (the PDF viewer). */
  constructor(
    private readonly view: Window = window,
    private readonly reducedMotion: () => boolean = () =>
      view.matchMedia('(prefers-reduced-motion: reduce)').matches,
    private readonly scroller?: HTMLElement,
  ) {
    this.target = scroller ?? view;
    this.target.addEventListener('wheel', this.onUser, { passive: true });
    this.target.addEventListener('touchmove', this.onUser, { passive: true });
    view.addEventListener('keydown', this.onKey, true);
    this.target.addEventListener('scroll', this.onScroll, { passive: true });
  }

  get suspended(): boolean {
    return performance.now() < this.suspendedUntil;
  }

  onSuspendChange(l: (suspended: boolean) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  resume(): void {
    this.suspendedUntil = 0;
    this.emit(false);
  }

  /** Scrolls so `rect` (viewport coordinates) sits in the comfortable band, unless suspended. */
  follow(rect: DOMRect | undefined): boolean {
    if (!rect || !this.enabled || this.suspended) return false;
    const box = this.scroller?.getBoundingClientRect();
    const top = box?.top ?? 0;
    const h = box?.height ?? this.view.innerHeight;
    const y = rect.top - top;
    if (y >= h * BAND.top && rect.bottom - top <= h * BAND.bottom) return false;
    const delta = y - h * BAND.target;
    const smooth = !this.reducedMotion();
    this.programmaticUntil = performance.now() + (smooth ? 900 : 100);
    this.target.scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'instant' });
    return true;
  }

  destroy(): void {
    this.target.removeEventListener('wheel', this.onUser);
    this.target.removeEventListener('touchmove', this.onUser);
    this.view.removeEventListener('keydown', this.onKey, true);
    this.target.removeEventListener('scroll', this.onScroll);
    if (this.timer) clearTimeout(this.timer);
  }

  private userScrolled(): void {
    const was = this.suspended;
    this.suspendedUntil = performance.now() + SUSPEND_MS;
    if (!was) this.emit(true);
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.emit(false), SUSPEND_MS + 10);
  }

  private emit(s: boolean): void {
    for (const l of this.listeners) l(s);
  }
}
