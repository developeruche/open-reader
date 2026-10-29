/** System voices (chrome.tts): the zero-download fallback (PLAN.md §6.5). */
import type { EngineCaps, InitOptions, RenderEngine, SynthesisResult } from '@/core/tts/engine';
import type { ModelManifest, VoiceInfo } from '@/core/tts/registry';
import type { TtsApi } from './tts';

export class SystemEngine implements RenderEngine {
  readonly kind = 'render' as const;
  readonly id = 'system';
  readonly caps: EngineCaps = {
    wordTimings: 'estimated',
    maxChars: 1000,
    requiresNetwork: false,
    backends: ['wasm'],
    live: true,
  };

  constructor(private readonly tts: TtsApi) {}

  async init(_model: ModelManifest, _opts: InitOptions): Promise<{ backend: string }> {
    return { backend: 'system' };
  }

  async voices(): Promise<VoiceInfo[]> {
    const all = await this.tts.getVoices();
    return all.map((v) => ({
      id: v.voiceName,
      name: v.remote ? `${v.voiceName} (online)` : v.voiceName,
      lang: v.lang ?? 'en',
    }));
  }

  /** Live engines never render PCM; the player plans the utterance instead. */
  async synthesize(): Promise<SynthesisResult> {
    throw new Error('System voices speak live; use LiveBackend');
  }

  async dispose(): Promise<void> {
    this.tts.stop();
  }
}
