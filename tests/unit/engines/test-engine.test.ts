import { MessageChannel } from 'node:worker_threads';
import type { Endpoint } from 'comlink';
import { describe, expect, it } from 'vitest';
import { isAbort, throwIfAborted } from '@/core/tts/engine';
import { RegistrySchema, ModelManifestSchema } from '@/core/tts/registry';
import { exposeEngine, RemoteEngine } from '@/engines/rpc';
import { synthesizeTone, TEST_SAMPLE_RATE, TestEngine } from '@/engines/test/engine';

const req = (text: string, speed = 1) => ({ text, voiceId: 'test', speed, lang: 'en' });

describe('TestEngine', () => {
  it('takes 60 ms per character at 1× and exact word timings', async () => {
    const r = await new TestEngine().synthesize(req('Hello world'));
    expect(r.sampleRate).toBe(TEST_SAMPLE_RATE);
    expect(r.pcm.length / r.sampleRate).toBeCloseTo(0.05 + 11 * 0.06, 3);
    expect(r.words).toEqual([
      { charStart: 0, charEnd: 5, start: expect.closeTo(0.05), end: expect.closeTo(0.35) },
      { charStart: 6, charEnd: 11, start: expect.closeTo(0.41), end: expect.closeTo(0.71) },
    ]);
  });

  it('divides duration by speed', () => {
    const a = synthesizeTone('abcdefghij', 1);
    const b = synthesizeTone('abcdefghij', 2);
    expect((b.pcm.length / TEST_SAMPLE_RATE - 0.05) * 2).toBeCloseTo(
      a.pcm.length / TEST_SAMPLE_RATE - 0.05,
      3,
    );
  });

  it('injects failures once, always, or by text', async () => {
    const e = new TestEngine({ failCalls: [1] });
    await e.synthesize(req('a'));
    await expect(e.synthesize(req('b'))).rejects.toThrow('injected failure on call 1');
    await expect(e.synthesize(req('c'))).resolves.toBeTruthy();
    const t = new TestEngine({ failText: 'BOOM' });
    await expect(t.synthesize(req('x BOOM'))).rejects.toThrow();
    expect(await t.voices()).toHaveLength(1);
    expect(await t.init({} as never, { backend: 'auto' })).toEqual({ backend: 'wasm' });
    await t.dispose();
  });

  it('stalls until aborted, and honours slow starts', async () => {
    const e = new TestEngine({ stallText: 'STALL', slowStartMs: 5 });
    const ac = new AbortController();
    const p = e.synthesize(req('STALL'), ac.signal);
    setTimeout(() => ac.abort(), 20);
    await expect(p).rejects.toSatisfy(isAbort);
    expect(() => throwIfAborted(ac.signal)).toThrow('Aborted');
    const pre = new AbortController();
    pre.abort();
    await expect(new TestEngine({ delayMs: 1 }).synthesize(req('x'), pre.signal)).rejects.toSatisfy(
      isAbort,
    );
  });
});

describe('worker RPC (comlink over a MessageChannel)', () => {
  it('synthesizes through the proxy and supports cancellation', async () => {
    const { port1, port2 } = new MessageChannel();
    exposeEngine(new TestEngine({ stallText: 'STALL' }), port1 as unknown as Endpoint);
    const remote = new RemoteEngine('test', new TestEngine().caps, port2 as unknown as Endpoint);
    const r = await remote.synthesize(req('Hi there'));
    expect(r.pcm).toBeInstanceOf(Float32Array);
    expect(r.words).toHaveLength(2);
    expect(await remote.voices()).toHaveLength(1);
    const ac = new AbortController();
    const p = remote.synthesize(req('STALL'), ac.signal);
    setTimeout(() => ac.abort(), 10);
    await expect(p).rejects.toSatisfy(isAbort);
    const pre = new AbortController();
    pre.abort();
    await expect(remote.synthesize(req('x'), pre.signal)).rejects.toSatisfy(isAbort);
    await remote.dispose();
    port1.close();
    port2.close();
  });
});

describe('registry schema', () => {
  const model = {
    id: 'kokoro-82m-v1-timestamped',
    engine: 'kokoro',
    displayName: 'Kokoro 82M',
    version: '1.0.0',
    license: { spdx: 'Apache-2.0', url: 'https://huggingface.co/hexgrad/Kokoro-82M' },
    sizeBytes: 400,
    sampleRate: 24000,
    files: [
      {
        path: 'onnx/model.onnx',
        url: 'https://huggingface.co/x/model.onnx',
        sha256: 'a'.repeat(64),
        bytes: 300,
        backend: 'webgpu',
      },
    ],
    voices: [{ id: 'af_heart', name: 'Heart', lang: 'en-US' }],
    defaultVoice: 'af_heart',
    caps: { wordTimings: 'native', backends: ['webgpu', 'wasm'] },
  };

  it('accepts a valid manifest and registry', () => {
    expect(ModelManifestSchema.parse(model).id).toBe(model.id);
    expect(RegistrySchema.parse({ version: 1, models: [model] }).models).toHaveLength(1);
  });

  it.each([
    ['bad sha', { files: [{ ...model.files[0], sha256: 'xyz' }] }],
    ['unknown default voice', { defaultVoice: 'nope' }],
    ['size smaller than files', { sizeBytes: 10 }],
    ['bad engine', { engine: 'tortoise' }],
    ['no voices', { voices: [] }],
  ])('rejects %s', (_n, patch) => {
    expect(() => ModelManifestSchema.parse({ ...model, ...patch })).toThrow();
  });

  it('rejects duplicate ids', () => {
    expect(() => RegistrySchema.parse({ version: 1, models: [model, model] })).toThrow();
  });
});
