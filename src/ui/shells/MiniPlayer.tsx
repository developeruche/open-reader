import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Crosshair, GripVertical, Pause, Play } from '../icons';
import { formatRate } from '../format';

export interface MiniPlayerProps {
  playing: boolean;
  rate: number;
  followSuspended: boolean;
  onToggle(): void;
  onRate(rate: number): void;
  onJump(): void;
}

const RATES = [1, 1.25, 1.5, 2, 2.5, 3];

/**
 * Self-contained CSS: the mini player lives in a closed shadow root on arbitrary pages, so it
 * cannot rely on the page or on Tailwind. Tokens are redefined on :host.
 */
export const MINI_PLAYER_CSS = `
:host { all: initial; position: fixed; z-index: 2147483646; right: 24px; bottom: 24px;
  --ink: #0b0b0b; --paper: #f6f4ef; font-family: 'Geist Variable', ui-sans-serif, system-ui, sans-serif; }
.pill { display: flex; align-items: center; gap: 2px; height: 44px; padding: 0 6px 0 2px; border-radius: 999px;
  background: var(--ink); color: var(--paper); box-shadow: 0 1px 2px rgba(0,0,0,.08), 0 8px 24px rgba(0,0,0,.06);
  font-size: 13px; line-height: 1; user-select: none; }
button { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; justify-content: center;
  height: 36px; min-width: 36px; padding: 0 10px; border-radius: 999px; color: inherit; cursor: default;
  transition: background-color 150ms cubic-bezier(.2,.8,.2,1); font-variant-numeric: tabular-nums; font-weight: 500; }
button:hover { background: rgba(246,244,239,.12); }
button:focus-visible { outline: 2px solid var(--paper); outline-offset: 2px; }
button.play { width: 36px; padding: 0; background: var(--paper); color: var(--ink); }
.grip { display: inline-flex; width: 20px; height: 36px; align-items: center; justify-content: center; opacity: .6; cursor: grab; touch-action: none; }
.lucide { stroke-width: 1.5; }
@media (prefers-reduced-motion: reduce) { button { transition: none; } }
`;

export function MiniPlayer({
  playing,
  rate,
  followSuspended,
  onToggle,
  onRate,
  onJump,
}: MiniPlayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);

  const onPointerDown = (e: ReactPointerEvent) => {
    const host = (ref.current?.getRootNode() as ShadowRoot | null)?.host as HTMLElement | undefined;
    if (!host) return;
    const r = host.getBoundingClientRect();
    setDrag({ x: e.clientX - r.left, y: e.clientY - r.top });
    (e.target as Element).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: ReactPointerEvent) => {
    const host = (ref.current?.getRootNode() as ShadowRoot | null)?.host as HTMLElement | undefined;
    if (!drag || !host) return;
    const x = Math.max(8, Math.min(innerWidth - host.offsetWidth - 8, e.clientX - drag.x));
    const y = Math.max(8, Math.min(innerHeight - host.offsetHeight - 8, e.clientY - drag.y));
    Object.assign(host.style, { left: `${x}px`, top: `${y}px`, right: 'auto', bottom: 'auto' });
  };

  const nextRate = RATES[(RATES.indexOf(rate) + 1) % RATES.length] ?? 1;
  return (
    <div ref={ref} className="pill" role="toolbar" aria-label="Open Reader">
      <span
        className="grip"
        aria-hidden
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => setDrag(null)}
      >
        <GripVertical size={16} />
      </span>
      <button
        type="button"
        className="play"
        aria-label={playing ? 'Pause' : 'Play'}
        onClick={onToggle}
      >
        {playing ? (
          <Pause size={16} fill="currentColor" aria-hidden />
        ) : (
          <Play size={16} fill="currentColor" aria-hidden />
        )}
      </button>
      <button
        type="button"
        aria-label={`Speed ${formatRate(rate)}, change to ${formatRate(nextRate)}`}
        onClick={() => onRate(nextRate)}
      >
        {formatRate(rate)}
      </button>
      <button
        type="button"
        aria-label={followSuspended ? 'Resume follow' : 'Jump to reading position'}
        onClick={onJump}
      >
        <Crosshair size={16} aria-hidden />
        {followSuspended ? <span style={{ marginLeft: 6 }}>Resume follow</span> : null}
      </button>
    </div>
  );
}

/** Mounts the mini player in a closed shadow root attached to a new host element. */
export function mountMiniPlayer(doc: Document = document): {
  root: Root;
  host: HTMLElement;
  shadow: ShadowRoot;
} {
  const host = doc.createElement('open-reader-mini');
  const shadow = host.attachShadow({ mode: 'closed' });
  const style = doc.createElement('style');
  style.textContent = MINI_PLAYER_CSS;
  const mountPoint = doc.createElement('div');
  shadow.append(style, mountPoint);
  doc.documentElement.append(host);
  return { root: createRoot(mountPoint), host, shadow };
}
