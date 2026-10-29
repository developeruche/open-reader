/**
 * Engine fallback ladder (PLAN.md §9.2): retry the same backend once, then WASM instead of WebGPU,
 * then another installed on-device engine, then system voices. Every switch is announced.
 */
export interface EngineChoice {
  engineId: string;
  modelId?: string;
  backend?: 'webgpu' | 'wasm';
  /** Voice to use on this rung; unset keeps the session's voice. */
  voice?: string;
}

const RENDER_ENGINES = ['kokoro', 'piper'] as const;

const NAMES: Record<string, string> = {
  kokoro: 'Kokoro',
  piper: 'Piper',
  system: 'system voices',
  test: 'the test voice',
};

/** Default voice when falling back to another engine (Kokoro: the owner's choice, ADR 0014). */
export function defaultVoice(engineId: string, modelId?: string): string {
  if (engineId === 'kokoro') return 'af_heart';
  if (engineId === 'piper' && modelId) return modelId.replace(/^piper-/, '');
  return '';
}

export function engineName(engineId: string): string {
  return NAMES[engineId] ?? engineId;
}

/**
 * The rungs after `primary`, in order. `installed` lists installed render models as
 * `{ engineId, modelId }`; system voices are offered when `system` is true.
 */
export function fallbackLadder(
  primary: EngineChoice,
  installed: { engineId: string; modelId: string }[],
  opts: { system: boolean },
): EngineChoice[] {
  const out: EngineChoice[] = [];
  const add = (c: EngineChoice) => {
    const same = (x: EngineChoice) =>
      x.engineId === c.engineId && x.modelId === c.modelId && x.backend === c.backend;
    if (!same(primary) && !out.some(same)) out.push(c);
  };
  const render = (RENDER_ENGINES as readonly string[]).includes(primary.engineId);
  if (render && primary.backend !== 'wasm')
    add({ engineId: primary.engineId, modelId: primary.modelId, backend: 'wasm' });
  // Prefer the other engine (Piper is the fast one), then other models of the same engine.
  const others = [...installed].sort(
    (a, b) => Number(a.engineId === primary.engineId) - Number(b.engineId === primary.engineId),
  );
  for (const m of others) {
    if (m.engineId === primary.engineId && m.modelId === primary.modelId) continue;
    add({ engineId: m.engineId, modelId: m.modelId, voice: defaultVoice(m.engineId, m.modelId) });
  }
  if (opts.system && primary.engineId !== 'system') add({ engineId: 'system', voice: '' });
  return out;
}

/** "Switched to Piper because WebGPU failed." */
export function switchMessage(from: EngineChoice, to: EngineChoice): string {
  if (from.engineId === to.engineId && to.backend === 'wasm')
    return `Switched ${engineName(from.engineId)} to WASM because WebGPU failed.`;
  const what =
    from.backend === 'webgpu' ? 'WebGPU' : engineName(from.engineId).replace(/^the /, '');
  return `Switched to ${engineName(to.engineId)} because ${what} failed.`;
}
