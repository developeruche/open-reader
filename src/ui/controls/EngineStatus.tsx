export interface EngineStatusProps {
  state: 'ready' | 'loading' | 'offline-ready' | 'error';
  text: string;
}

const GLYPH = { ready: '●', loading: '◐', 'offline-ready': '●', error: '▲' } as const;

/** Footer status line, e.g. "On-device · Kokoro · WebGPU". The glyph differs by state, not colour. */
export function EngineStatus({ state, text }: EngineStatusProps) {
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-muted">
      <span aria-hidden className="text-[9px] text-ink">
        {GLYPH[state]}
      </span>
      {state === 'error' ? <strong className="font-semibold text-ink">Engine error:</strong> : null}
      <span className="truncate">{text}</span>
    </p>
  );
}
