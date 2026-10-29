/**
 * Kokoro-82M v1.0 (timestamped ONNX) on onnxruntime-web, WebGPU first, WASM fallback
 * (PLAN.md §6.2, ADR 0003). Runs inside a worker; model files come from OPFS or a URL.
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
import { Language } from './headtts/language-en-us.mjs';
import { createTokenizer, type KokoroTokenizer } from './tokenizer';
import { g2pWords, tokenTimes, wordTimings } from './timing';

export const STYLE_DIM = 256;
const MAX_TOKENS = 510;
export const KOKORO_SAMPLE_RATE = 24000;

export interface KokoroDeps {
  /** Reads a model file (path from the manifest). */
  readFile(path: string): Promise<ArrayBuffer>;
  /** URL of the bundled G2P dictionary. */
  dictionaryUrl: string;
  /** Base URL of the bundled onnxruntime-web WASM files. */
  ortBase: string;
  loadOrt?(): Promise<typeof Ort>;
}

export async function detectBackend(): Promise<'webgpu' | 'wasm'> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return 'wasm';
  try {
    return (await gpu.requestAdapter()) ? 'webgpu' : 'wasm';
  } catch {
    return 'wasm';
  }
}

/** WebGPU storage buffer cache for Kokoro (ADR 0017). */
export const KOKORO_GPU_CACHE = 'lazyRelease' as const;

export class KokoroEngine implements RenderEngine {
  readonly kind = 'render' as const;
  readonly id = 'kokoro';
  readonly caps: EngineCaps = {
    wordTimings: 'native',
    maxChars: 300,
    requiresNetwork: false,
    backends: ['webgpu', 'wasm'],
  };
  private ort: typeof Ort | undefined;
  private session: Ort.InferenceSession | undefined;
  private tokenizer: KokoroTokenizer | undefined;
  private lang: Language | undefined;
  private model: ModelManifest | undefined;
  private readonly styles = new Map<string, Float32Array>();
  backend: 'webgpu' | 'wasm' = 'wasm';

  constructor(private readonly deps: KokoroDeps) {}

  async init(model: ModelManifest, opts: InitOptions): Promise<{ backend: string }> {
    this.model = model;
    this.backend = opts.backend === 'auto' ? await detectBackend() : opts.backend;
    const file =
      model.files.find((f) => f.backend === this.backend) ??
      model.files.find((f) => f.path.endsWith('.onnx'));
    if (!file) throw new Error(`No model file for ${this.backend}`);
    const ort = (this.ort ??= await (this.deps.loadOrt?.() ?? import('onnxruntime-web/webgpu')));
    ort.env.wasm.wasmPaths = this.deps.ortBase;
    // ORT warns when it keeps small shape ops on the CPU, which is normal here; those warnings
    // filled chrome://extensions → Errors. Only real errors are logged.
    ort.env.logLevel = 'error';
    ort.env.wasm.numThreads =
      this.backend === 'wasm'
        ? Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 4) - 2))
        : 1;
    opts.onProgress?.({ loaded: 0, total: 3, label: 'Loading voice model' });
    const [weights, tok] = await Promise.all([
      this.deps.readFile(file.path),
      this.deps.readFile('tokenizer.json'),
    ]);
    this.tokenizer = createTokenizer(
      JSON.parse(new TextDecoder().decode(tok)) as Parameters<typeof createTokenizer>[0],
    );
    opts.onProgress?.({ loaded: 1, total: 3, label: 'Loading pronunciation dictionary' });
    const lang = new Language({});
    await lang.loadDictionary(this.deps.dictionaryUrl);
    this.lang = lang;
    opts.onProgress?.({
      loaded: 2,
      total: 3,
      label: `Starting ${this.backend === 'webgpu' ? 'WebGPU' : 'WASM'}`,
    });
    await this.session?.release();
    const input = sessionInput(new Uint8Array(weights), this.backend);
    this.session = await ort.InferenceSession.create(input.model, {
      logSeverityLevel: 3,
      // External data keeps ORT's WASM heap at ≈ 33 MB instead of 757 MB (ADR 0018).
      ...(input.externalData ? { externalData: input.externalData } : {}),
      // Kokoro's inputs vary in length: the default 'bucket' cache keeps a buffer per size bucket
      // and grew GPU memory past 1.8 GB over a long read. Release buffers after each run (ADR 0017).
      executionProviders: [
        this.backend === 'webgpu'
          ? { name: 'webgpu', storageBufferCacheMode: KOKORO_GPU_CACHE }
          : this.backend,
      ],
      graphOptimizationLevel: 'all',
    });
    opts.onProgress?.({ loaded: 3, total: 3 });
    return { backend: this.backend };
  }

  async voices(): Promise<VoiceInfo[]> {
    return this.model?.voices ?? [];
  }

  private async style(voiceId: string, tokens: number): Promise<Float32Array> {
    let s = this.styles.get(voiceId);
    if (!s) {
      const known = this.model?.voices.some((v) => v.id === voiceId)
        ? voiceId
        : (this.model?.defaultVoice ?? voiceId);
      s = new Float32Array(await this.deps.readFile(`voices/${known}.bin`));
      this.styles.set(voiceId, s);
    }
    const row = Math.min(Math.max(tokens, 0), Math.floor(s.length / STYLE_DIM) - 1);
    return s.slice(row * STYLE_DIM, (row + 1) * STYLE_DIM);
  }

  async synthesize(req: SynthesisRequest, signal?: AbortSignal): Promise<SynthesisResult> {
    const { session, tokenizer, lang, ort } = this;
    if (!session || !tokenizer || !lang || !ort) throw new Error('Kokoro is not initialized');
    if (signal?.aborted) throw new AbortError();
    const g = lang.generate(req.text);
    const phonemes = g.phonemes.join('');
    const { ids, tokenOf } = tokenizer.encode(phonemes);
    if (ids.length > MAX_TOKENS + 2) return this.splitAndSynthesize(req, signal);
    const style = await this.style(req.voiceId, ids.length - 2);
    const out = await session.run({
      input_ids: new ort.Tensor(
        'int64',
        BigInt64Array.from(ids, (x) => BigInt(x)),
        [1, ids.length],
      ),
      style: new ort.Tensor('float32', style, [1, STYLE_DIM]),
      speed: new ort.Tensor('float32', new Float32Array([req.speed]), [1]),
    });
    if (signal?.aborted) throw new AbortError();
    const waveform = out.waveform?.data as Float32Array | undefined;
    const durations = out.durations?.data as ArrayLike<number | bigint> | undefined;
    if (!waveform || !durations) throw new Error('Kokoro returned no audio');
    // tokenOf already counts the leading pad, so times[tokenOf[i]] is when phoneme i starts.
    const times = tokenTimes(durations);
    const words = wordTimings(
      g2pWords(req.text, g.metadata.words, g.metadata.wtimes, g.metadata.wdurations),
      tokenOf,
      times,
    );
    return { pcm: new Float32Array(waveform), sampleRate: KOKORO_SAMPLE_RATE, words };
  }

  /** Over the 510-token limit: split at the middle space and join the halves. */
  private async splitAndSynthesize(
    req: SynthesisRequest,
    signal?: AbortSignal,
  ): Promise<SynthesisResult> {
    const mid = req.text.lastIndexOf(' ', Math.floor(req.text.length / 2));
    if (mid <= 0) throw new Error('Sentence too long for Kokoro');
    const a = await this.synthesize({ ...req, text: req.text.slice(0, mid) }, signal);
    const b = await this.synthesize({ ...req, text: req.text.slice(mid + 1) }, signal);
    const pcm = new Float32Array(a.pcm.length + b.pcm.length);
    pcm.set(a.pcm);
    pcm.set(b.pcm, a.pcm.length);
    const shift = a.pcm.length / a.sampleRate;
    const words = [
      ...(a.words ?? []),
      ...(b.words ?? []).map((w) => ({
        charStart: w.charStart + mid + 1,
        charEnd: w.charEnd + mid + 1,
        start: w.start + shift,
        end: w.end + shift,
      })),
    ];
    return { pcm, sampleRate: a.sampleRate, words };
  }

  async dispose(): Promise<void> {
    await this.session?.release();
    this.session = undefined;
  }
}
