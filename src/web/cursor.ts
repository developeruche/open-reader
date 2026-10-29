/**
 * The reading cursor: a 2 px bar under the current word, drawn in a closed shadow root and moved
 * with a compositor-only transform (§3.3). Jumps instead of gliding under reduced motion.
 */
import type { Variant } from './highlightCss';

export class CursorOverlay {
  private readonly host: HTMLElement;
  private readonly bar: HTMLElement;
  private visible = false;

  constructor(private readonly doc: Document = document) {
    this.host = doc.createElement('open-reader-cursor');
    Object.assign(this.host.style, {
      position: 'fixed',
      inset: '0',
      pointerEvents: 'none',
      zIndex: '2147483645',
    });
    const shadow = this.host.attachShadow({ mode: 'closed' });
    const style = doc.createElement('style');
    style.textContent = `
      .bar { position: absolute; top: 0; left: 0; height: 2px; width: 100px; border-radius: 2px; transform-origin: 0 0;
        background: #0b0b0b; opacity: 0; transition: transform 120ms cubic-bezier(.2,.8,.2,1), opacity 120ms; will-change: transform; }
      .bar.dark { background: #f6f4ef; }
      .bar.on { opacity: 1; }
      @media (prefers-reduced-motion: reduce) { .bar { transition: none; } }`;
    this.bar = doc.createElement('div');
    this.bar.className = 'bar';
    shadow.append(style, this.bar);
    doc.documentElement.append(this.host);
  }

  setVariant(v: Variant): void {
    this.bar.classList.toggle('dark', v === 'dark');
  }

  /** Positions the bar under the last line box of the word range (viewport coordinates). */
  show(word: Range | undefined): void {
    const rects = word ? [...word.getClientRects()].filter((r) => r.width > 0) : [];
    const r = rects.at(-1);
    if (!r) return this.hide();
    this.bar.style.transform = `translate(${r.left}px, ${r.bottom + 1}px) scaleX(${r.width / 100})`;
    if (!this.visible) this.bar.classList.add('on');
    this.visible = true;
  }

  hide(): void {
    this.bar.classList.remove('on');
    this.visible = false;
  }

  destroy(): void {
    this.host.remove();
  }
}
