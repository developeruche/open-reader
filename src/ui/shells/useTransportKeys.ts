import { useEffect } from 'react';
import { useMockPlayer } from '../mock/mockPlayer';

const SPEED_STEP = 0.25;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  return (
    el.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) ||
    el.getAttribute('role') === 'slider'
  );
}

/** In-page shortcuts from §7.3 (Space, J/K, −/=, F, Esc), ignored while typing. */
export function useTransportKeys(): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
      const p = useMockPlayer.getState();
      const t = e.target as HTMLElement | null;
      switch (e.key) {
        case ' ':
          if (t?.closest('button,[role=tab],[role=radio],a')) return; // let the focused control handle Space
          e.preventDefault();
          p.toggle();
          break;
        case 'j':
          p.prev();
          break;
        case 'k':
          p.next();
          break;
        case '-':
          p.setRate(Math.max(0.5, +(p.rate - SPEED_STEP).toFixed(2)));
          break;
        case '=':
          p.setRate(Math.min(4, +(p.rate + SPEED_STEP).toFixed(2)));
          break;
        case 'f':
          p.setFollow(!p.follow);
          break;
        case 'Escape':
          p.pause();
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
}
