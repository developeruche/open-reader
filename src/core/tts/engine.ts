/** Engine abstraction (PLAN.md §5.3). Engines never touch playback or chrome.*. */
import type { WordTiming } from '../audio/timing';
import type { Backend, ModelManifest, VoiceInfo } from './registry';

export interface ModelRef {
  modelId: string;
  version: string;
  voiceId: string;
}

export interface SynthesisRequest {
  text: string;
  voiceId: string;
  /** Model speed (1 = natural); playback rate is applied separately. */
  speed: number;
  lang: string;
}

export interface SynthesisResult {
  pcm: Float32Array;
  sampleRate: number;
  /** Native timings if the engine provides them. */
  words?: WordTiming[];
}

export interface Progress {
  loaded: number;
  total: number;
  label?: string;
}

export interface EngineCaps {
  wordTimings: 'native' | 'estimated';
  maxChars: number;
  requiresNetwork: boolean;
  backends: Backend[];
  /** Speaks by itself (chrome.tts); the player plans timings but never gets PCM. */
  live?: boolean;
}

export interface InitOptions {
  backend: 'auto' | 'webgpu' | 'wasm';
  onProgress?: (p: Progress) => void;
  signal?: AbortSignal;
}

export interface RenderEngine {
  readonly kind: 'render';
  readonly id: string;
  readonly caps: EngineCaps;
  init(model: ModelManifest, opts: InitOptions): Promise<{ backend: string }>;
  voices(): Promise<VoiceInfo[]>;
  synthesize(req: SynthesisRequest, signal?: AbortSignal): Promise<SynthesisResult>;
  dispose(): Promise<void>;
}

export interface LiveEngine {
  readonly kind: 'live';
  readonly id: 'system';
  speak(
    req: SynthesisRequest,
    on: { word(charIndex: number): void; end(): void; error(e: Error): void },
  ): void;
  pause(): void;
  resume(): void;
  stop(): void;
  voices(): Promise<VoiceInfo[]>;
}

export type Engine = RenderEngine | LiveEngine;

export class AbortError extends Error {
  constructor() {
    super('Aborted');
    this.name = 'AbortError';
  }
}

export const isAbort = (e: unknown): boolean => e instanceof Error && e.name === 'AbortError';

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AbortError();
}
