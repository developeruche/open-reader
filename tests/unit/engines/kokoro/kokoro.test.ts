import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { KokoroEngine, STYLE_DIM } from '@/engines/kokoro/engine';
import { createTokenizer } from '@/engines/kokoro/tokenizer';
import { FRAME_RATE, g2pWords, tokenTimes, wordTimings } from '@/engines/kokoro/timing';
import { REGISTRY } from '@/engines/factory';

const vocab: Record<string, number> = { $: 0, a: 1, b: 2, ' ': 3, '.': 4 };

describe('Kokoro tokenizer', () => {
  it('wraps with pads and maps phoneme indices to token indices, dropping unknown chars', () => {
    const t = createTokenizer({ model: { vocab } });
    const { ids, tokenOf } = t.encode('ab?a');
    expect(ids).toEqual([0, 1, 2, 1, 0]);
    expect([...tokenOf]).toEqual([1, 2, 3, 3, 4]);
  });
});

describe('Kokoro timing', () => {
  it('turns frame durations into cumulative seconds', () => {
    tokenTimes([4, 8, 2n]).forEach((t, i) =>
      expect(t).toBeCloseTo([0, 4, 12, 14][i]! / FRAME_RATE, 9),
    );
  });

  it('maps HeadTTS words to char ranges and token times', () => {
    const input = '  Hello, world!';
    const words = g2pWords(input, ['  Hello, ', 'world!'], [0, 6], [6, 12]);
    expect(words.map((w) => input.slice(w.charStart, w.charEnd))).toEqual(['Hello,', 'world!']);
    const tokenOf = Int32Array.from({ length: 13 }, (_, i) => i + 1);
    const times = tokenTimes(new Array(14).fill(4));
    const timed = wordTimings(words, tokenOf, times);
    expect(timed[0]!.start).toBeCloseTo(0.1);
    expect(timed[0]!.end).toBeCloseTo(0.7);
    expect(timed[1]!.end).toBeCloseTo(1.3);
  });

  it('falls back to searching the input when words were rewritten', () => {
    const words = g2pWords('five dollars', ['5 ', 'dollars'], [0, 4], [4, 10]);
    expect(words[1]).toMatchObject({ charStart: 5, charEnd: 12 });
  });
});

describe('KokoroEngine (fake onnxruntime, real G2P)', () => {
  const model = REGISTRY.models.find((m) => m.engine === 'kokoro')!;
  const dict = path.resolve('assets/g2p/en-us.txt');
  const voice = new Float32Array(510 * STYLE_DIM).map((_, i) => i / 1000);
  const tokenizerJson = JSON.parse(
    readFileSync('tests/fixtures/kokoro/tokenizer.json', 'utf8').toString(),
  ) as object;

  function engine(runs: { feeds: Record<string, { dims: number[]; data: unknown }> }[] = []) {
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
          run: async (feeds: Record<string, { dims: number[]; data: unknown }>) => {
            runs.push({ feeds });
            const n = feeds.input_ids!.dims[1]!;
            return {
              waveform: { data: new Float32Array(n * 600).fill(0.1) },
              durations: { data: new Array(n).fill(1) },
            };
          },
          release: async () => undefined,
        }),
      },
    };
    const files: Record<string, ArrayBuffer> = {
      'tokenizer.json': new TextEncoder().encode(JSON.stringify(tokenizerJson))
        .buffer as ArrayBuffer,
      'onnx/model_quantized.onnx': new ArrayBuffer(8),
      'voices/af_heart.bin': voice.buffer,
    };
    return new KokoroEngine({
      readFile: async (p) => {
        const f = files[p];
        if (!f) throw new Error(`missing ${p}`);
        return f;
      },
      dictionaryUrl: dict,
      ortBase: '/ort/',
      loadOrt: async () => ort as never,
    });
  }

  it('synthesizes with native word timings covering the input', async () => {
    const runs: { feeds: Record<string, { dims: number[]; data: unknown }> }[] = [];
    const e = engine(runs);
    expect(await e.init(model, { backend: 'wasm' })).toEqual({ backend: 'wasm' });
    expect(await e.voices()).toHaveLength(4);
    const text = 'The signer checks the amounts.';
    const r = await e.synthesize({ text, voiceId: 'af_heart', speed: 1.25, lang: 'en' });
    expect(r.sampleRate).toBe(24000);
    expect(r.words!.map((w) => text.slice(w.charStart, w.charEnd))).toEqual([
      'The',
      'signer',
      'checks',
      'the',
      'amounts.',
    ]);
    for (let i = 1; i < r.words!.length; i++)
      expect(r.words![i]!.start).toBeGreaterThanOrEqual(r.words![i - 1]!.end - 1e-9);
    const feeds = runs[0]!.feeds;
    expect(feeds.style!.dims).toEqual([1, STYLE_DIM]);
    expect((feeds.speed!.data as Float32Array)[0]).toBeCloseTo(1.25);
    // Unknown voices fall back to the default voice file.
    await e.synthesize({ text: 'Hi.', voiceId: 'nope', speed: 1, lang: 'en' });
    await e.dispose();
    await expect(
      e.synthesize({ text: 'x', voiceId: 'af_heart', speed: 1, lang: 'en' }),
    ).rejects.toThrow('not initialized');
  });

  it('splits sentences over the token limit and joins timings', async () => {
    const e = engine();
    await e.init(model, { backend: 'wasm' });
    const text =
      Array.from({ length: 60 }, (_, i) => `word${i} antidisestablishment`).join(' ') + '.';
    const r = await e.synthesize({ text, voiceId: 'af_heart', speed: 1, lang: 'en' });
    const last = r.words!.at(-1)!;
    expect(text.slice(last.charStart, last.charEnd)).toBe('antidisestablishment.');
    expect(last.end).toBeLessThanOrEqual(r.pcm.length / r.sampleRate + 1e-6);
  });

  it('aborts', async () => {
    const e = engine();
    await e.init(model, { backend: 'wasm' });
    const ac = new AbortController();
    ac.abort();
    await expect(
      e.synthesize({ text: 'x', voiceId: 'af_heart', speed: 1, lang: 'en' }, ac.signal),
    ).rejects.toThrow('Aborted');
  });
});
