/**
 * Piper (VITS ONNX) with espeak-ng phonemes from piper_phonemize, all bundled (PLAN.md §6.3,
 * ADR 0004). WebGPU or multi-threaded WASM; word timings are estimated by the player (§5.4.4).
 */
import type * as Ort from 'onnxruntime-web';
import { sessionInput } from '../onnx/externalize';
import {
  AbortError,
  type EngineCaps,
  type InitOptions,
  type RenderEngine,
  type SynthesisRequest,
  type SynthesisResult,
} from '@/core/tts/engine';
import type { ModelManifest, VoiceInfo } from '@/core/tts/registry';
import { detectBackend } from '../kokoro/engine';

/** Matches the owner's preferred sound for the PSBT audiobook (§6.3). */
export const PIPER_LENGTH_SCALE = 1.1;

export interface PiperConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers?: number;
}

export type Phonemize = (text: string, espeakVoice: string) => Promise<number[]>;

export interface PiperDeps {
  readFile(path: string): Promise<ArrayBuffer>;
  phonemize: Phonemize;
  ortBase: string;
  loadOrt?(): Promise<typeof Ort>;
}

export class PiperEngine implements RenderEngine {
  readonly kind = 'render' as const;
  readonly id = 'piper';
  readonly caps: EngineCaps = {
    wordTimings: 'estimated',
    maxChars: 400,
    requiresNetwork: false,
    backends: ['webgpu', 'wasm'],
  };
  private ort: typeof Ort | undefined;
  private session: Ort.InferenceSession | undefined;
  private config: PiperConfig | undefined;
  private model: ModelManifest | undefined;
  backend: 'webgpu' | 'wasm' = 'wasm';

  constructor(private readonly deps: PiperDeps) {}

  async init(model: ModelManifest, opts: InitOptions): Promise<{ backend: string }> {
    this.model = model;
    this.backend = opts.backend === 'auto' ? await detectBackend() : opts.backend;
    const onnx = model.files.find((f) => f.path.endsWith('.onnx'));
    const json = model.files.find((f) => f.path.endsWith('.onnx.json'));
    if (!onnx || !json) throw new Error('Piper model needs .onnx and .onnx.json files');
    const ort = (this.ort ??= await (this.deps.loadOrt?.() ?? import('onnxruntime-web/webgpu')));
    ort.env.wasm.wasmPaths = this.deps.ortBase;
    ort.env.wasm.numThreads =
      this.backend === 'wasm'
        ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 2))
        : 1;
    const [weights, cfg] = await Promise.all([
      this.deps.readFile(onnx.path),
      this.deps.readFile(json.path),
    ]);
    this.config = JSON.parse(new TextDecoder().decode(cfg)) as PiperConfig;
    await this.session?.release();
    const input = sessionInput(new Uint8Array(weights), this.backend);
    this.session = await ort.InferenceSession.create(input.model, {
      ...(input.externalData ? { externalData: input.externalData } : {}),
      executionProviders: [this.backend],
    });
    return { backend: this.backend };
  }

  async voices(): Promise<VoiceInfo[]> {
    return this.model?.voices ?? [];
  }

  async synthesize(req: SynthesisRequest, signal?: AbortSignal): Promise<SynthesisResult> {
    const { session, config, ort } = this;
    if (!session || !config || !ort) throw new Error('Piper is not initialized');
    if (signal?.aborted) throw new AbortError();
    const ids = await this.deps.phonemize(req.text, config.espeak.voice);
    const feeds: Record<string, Ort.Tensor> = {
      input: new ort.Tensor(
        'int64',
        BigInt64Array.from(ids, (x) => BigInt(x)),
        [1, ids.length],
      ),
      input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)]), [1]),
      scales: new ort.Tensor(
        'float32',
        new Float32Array([
          config.inference.noise_scale,
          PIPER_LENGTH_SCALE / Math.max(0.25, req.speed),
          config.inference.noise_w,
        ]),
        [3],
      ),
    };
    if ((config.num_speakers ?? 1) > 1)
      feeds.sid = new ort.Tensor('int64', BigInt64Array.from([0n]), [1]);
    const out = await session.run(feeds);
    if (signal?.aborted) throw new AbortError();
    const pcm = out.output?.data as Float32Array | undefined;
    if (!pcm) throw new Error('Piper returned no audio');
    return { pcm: new Float32Array(pcm), sampleRate: config.audio.sample_rate };
  }

  async dispose(): Promise<void> {
    await this.session?.release();
    this.session = undefined;
  }
}
