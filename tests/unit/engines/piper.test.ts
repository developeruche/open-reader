import { describe, expect, it } from 'vitest';
import { PIPER_LENGTH_SCALE, PiperEngine } from '@/engines/piper/engine';
import { REGISTRY } from '@/engines/factory';

const config = {
  audio: { sample_rate: 22050 },
  espeak: { voice: 'en-us' },
  inference: { noise_scale: 0.667, length_scale: 1, noise_w: 0.8 },
};

function engine(runs: Record<string, { data: unknown; dims: number[] }>[], numSpeakers = 1) {
  class Tensor {
    constructor(
      readonly type: string,
      readonly data: unknown,
      readonly dims: number[],
    ) {}
  }
  const ort = {
    env: { wasm: {} as Record<string, unknown> },
    Tensor,
    InferenceSession: {
      create: async () => ({
        run: async (feeds: Record<string, { data: unknown; dims: number[] }>) => {
          runs.push(feeds);
          return { output: { data: new Float32Array(2205).fill(0.2) } };
        },
        release: async () => undefined,
      }),
    },
  };
  const model = REGISTRY.models.find((m) => m.id === 'piper-en_US-lessac-high')!;
  return new PiperEngine({
    readFile: async (p) =>
      (p.endsWith('.json')
        ? new TextEncoder().encode(JSON.stringify({ ...config, num_speakers: numSpeakers })).buffer
        : new ArrayBuffer(4)) as ArrayBuffer,
    phonemize: async (text, voice) => [1, text.length, voice.length],
    ortBase: '/ort/',
    loadOrt: async () => ort as never,
  })
    .init(model, { backend: 'wasm' })
    .then(() => ({ model }));
}

describe('PiperEngine (fake onnxruntime)', () => {
  it('phonemizes, sets scales (length 1.1 ÷ speed) and returns 22.05 kHz audio', async () => {
    const runs: Record<string, { data: unknown; dims: number[] }>[] = [];
    const runsMulti: Record<string, { data: unknown; dims: number[] }>[] = [];
    await engine(runs);
    class T {
      constructor(
        readonly type: string,
        readonly data: unknown,
        readonly dims: number[],
      ) {}
    }
    const e = new PiperEngine({
      readFile: async (p) =>
        (p.endsWith('.json')
          ? new TextEncoder().encode(JSON.stringify({ ...config, num_speakers: 2 })).buffer
          : new ArrayBuffer(4)) as ArrayBuffer,
      phonemize: async () => [1, 2, 3],
      ortBase: '/ort/',
      loadOrt: async () =>
        ({
          env: { wasm: {} },
          Tensor: T,
          InferenceSession: {
            create: async () => ({
              run: async (f: Record<string, { data: unknown; dims: number[] }>) => (
                runsMulti.push(f),
                { output: { data: new Float32Array(100) } }
              ),
              release: async () => undefined,
            }),
          },
        }) as never,
    });
    const model = REGISTRY.models.find((m) => m.id === 'piper-en_US-lessac-high')!;
    await e.init(model, { backend: 'wasm' });
    const r = await e.synthesize({ text: 'Hello there', voiceId: 'x', speed: 2, lang: 'en' });
    expect(r.sampleRate).toBe(22050);
    expect(r.words).toBeUndefined();
    expect(runsMulti[0]!.sid).toBeDefined();
    const scales = runsMulti[0]!.scales!.data as Float32Array;
    expect(scales[1]).toBeCloseTo(PIPER_LENGTH_SCALE / 2);
    expect(await e.voices()).toHaveLength(1);
    await e.dispose();
    await expect(e.synthesize({ text: 'x', voiceId: 'x', speed: 1, lang: 'en' })).rejects.toThrow(
      'not initialized',
    );
  });

  it('rejects incomplete models and honours abort', async () => {
    const e = new PiperEngine({
      readFile: async () => new ArrayBuffer(0),
      phonemize: async () => [],
      ortBase: '/',
      loadOrt: async () => ({}) as never,
    });
    await expect(
      e.init({ ...REGISTRY.models[1]!, files: [] }, { backend: 'wasm' }),
    ).rejects.toThrow('.onnx');
    const ac = new AbortController();
    ac.abort();
    await expect(
      e.synthesize({ text: 'x', voiceId: 'x', speed: 1, lang: 'en' }, ac.signal),
    ).rejects.toThrow();
  });
});
