/**
 * TestEngine (PLAN.md §11): deterministic synthesis for tests and E2E.
 * 60 ms per character at 1× divided by speed, a quiet sine so audio elements genuinely play,
 * exact word timings, and failure injection.
 */
import type { WordTiming } from '@/core/audio/timing';
import {
  AbortError,
  type EngineCaps,
  type InitOptions,
  type RenderEngine,
  type SynthesisRequest,
  type SynthesisResult,
} from '@/core/tts/engine';
import type { ModelManifest, VoiceInfo } from '@/core/tts/registry';

export interface TestEngineFaults {
  /** 0-based synthesize() calls that reject (each fails once unless `failAlways`). */
  failCalls?: number[];
  failAlways?: boolean;
  /** Fail any request whose text contains this marker. */
  failText?: string;
  /** Extra delay for the first call (cold start). */
  slowStartMs?: number;
  /** Delay for every call (simulated synthesis time). */
  delayMs?: number;
  /** Never resolve calls whose text contains this marker (until aborted). */
  stallText?: string;
}

export const TEST_MS_PER_CHAR = 60;
export const TEST_SAMPLE_RATE = 8000;
const LEAD_IN = 0.05; // seconds of silence before speech, so trimming is exercised

export class TestEngine implements RenderEngine {
  readonly kind = 'render' as const;
  readonly id = 'test';
  readonly caps: EngineCaps = {
    wordTimings: 'native',
    maxChars: 300,
    requiresNetwork: false,
    backends: ['wasm'],
  };
  calls = 0;
  readonly requests: SynthesisRequest[] = [];
  private readonly failed = new Set<number>();

  constructor(
    private readonly faults: TestEngineFaults = {},
    private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void> = defaultSleep,
  ) {}

  async init(_model: ModelManifest, _opts: InitOptions): Promise<{ backend: string }> {
    return { backend: 'wasm' };
  }

  async voices(): Promise<VoiceInfo[]> {
    return [{ id: 'test', name: 'Test tone', lang: 'en' }];
  }

  async synthesize(req: SynthesisRequest, signal?: AbortSignal): Promise<SynthesisResult> {
    const call = this.calls++;
    this.requests.push(req);
    const f = this.faults;
    const delay = (call === 0 ? (f.slowStartMs ?? 0) : 0) + (f.delayMs ?? 0);
    if (delay) await this.sleep(delay, signal);
    if (signal?.aborted) throw new AbortError();
    if (f.stallText && req.text.includes(f.stallText))
      await this.sleep(Number.MAX_SAFE_INTEGER, signal);
    if (
      (f.failCalls?.includes(call) && (f.failAlways || !this.failed.has(call))) ||
      (f.failText && req.text.includes(f.failText))
    ) {
      this.failed.add(call);
      throw new Error(`TestEngine: injected failure on call ${call}`);
    }
    return synthesizeTone(req.text, req.speed);
  }

  async dispose(): Promise<void> {}
}

/** Pure tone synthesis with exact timings: each character takes 60 ms / speed. */
export function synthesizeTone(
  text: string,
  speed = 1,
  sampleRate = TEST_SAMPLE_RATE,
): SynthesisResult {
  const perChar = TEST_MS_PER_CHAR / 1000 / speed;
  const speech = text.length * perChar;
  const n = Math.round((LEAD_IN + speech) * sampleRate);
  const pcm = new Float32Array(n);
  const lead = Math.round(LEAD_IN * sampleRate);
  for (let i = lead; i < n; i++) pcm[i] = 0.1 * Math.sin((2 * Math.PI * 330 * i) / sampleRate);
  const words: WordTiming[] = [];
  const re = /[\p{L}\p{N}][\p{L}\p{N}'’.-]*/gu;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    words.push({
      charStart: m.index,
      charEnd: m.index + m[0].length,
      start: LEAD_IN + m.index * perChar,
      end: LEAD_IN + (m.index + m[0].length) * perChar,
    });
  }
  return { pcm, sampleRate, words };
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new AbortError());
    const t = setTimeout(resolve, Math.min(ms, 2 ** 31 - 1));
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(new AbortError());
    });
  });
}
