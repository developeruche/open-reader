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

  constructor(
    private readonly view: Window = window,
    private readonly reducedMotion: () => boolean = () =>
      view.matchMedia('(prefers-reduced-motion: reduce)').matches,
  ) {
    view.addEventListener('wheel', this.onUser, { passive: true });
    view.addEventListener('touchmove', this.onUser, { passive: true });
    view.addEventListener('keydown', this.onKey, true);
    view.addEventListener('scroll', this.onScroll, { passive: true });
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
    const h = this.view.innerHeight;
    if (rect.top >= h * BAND.top && rect.bottom <= h * BAND.bottom) return false;
    const delta = rect.top - h * BAND.target;
    const smooth = !this.reducedMotion();
    this.programmaticUntil = performance.now() + (smooth ? 900 : 100);
    this.view.scrollBy({ top: delta, behavior: smooth ? 'smooth' : 'instant' });
    return true;
  }

  destroy(): void {
    this.view.removeEventListener('wheel', this.onUser);
    this.view.removeEventListener('touchmove', this.onUser);
    this.view.removeEventListener('keydown', this.onKey, true);
    this.view.removeEventListener('scroll', this.onScroll);
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
