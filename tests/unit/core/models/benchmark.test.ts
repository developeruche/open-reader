import { describe, expect, it } from 'vitest';
import {
  chooseDefault,
  describeResult,
  RtfMonitor,
  type BenchmarkResult,
} from '@/core/models/benchmark';
import { DEFAULT_SETTINGS, migrateSettings } from '@/core/settings';

const r = (
  engineId: 'kokoro' | 'piper',
  modelId: string,
  backend: 'webgpu' | 'wasm',
  rtf: number,
  extra: Partial<BenchmarkResult> = {},
): BenchmarkResult => ({
  engineId,
  modelId,
  backend,
  rtf,
  firstAudioMs: 300,
  audible: true,
  ...extra,
});

describe('chooseDefault (§6.4)', () => {
  it('prefers Kokoro on WebGPU when fast enough', () => {
    expect(
      chooseDefault([
        r('kokoro', 'k', 'webgpu', 0.11),
        r('piper', 'piper-en_US-lessac-high', 'webgpu', 0.05),
      ]),
    ).toEqual({ engineId: 'kokoro', modelId: 'k', backend: 'webgpu' });
  });
  it('falls back to Piper lessac-high, then lessac-medium', () => {
    expect(
      chooseDefault([
        r('kokoro', 'k', 'webgpu', 0.9),
        r('piper', 'piper-en_US-lessac-high', 'wasm', 0.42),
      ])?.modelId,
    ).toBe('piper-en_US-lessac-high');
    expect(
      chooseDefault([
        r('kokoro', 'k', 'webgpu', 0.9),
        r('piper', 'piper-en_US-lessac-high', 'wasm', 1.6),
        r('piper', 'piper-en_US-lessac-medium', 'wasm', 0.19),
      ])?.modelId,
    ).toBe('piper-en_US-lessac-medium');
  });
  it('never picks silent or failed output (Kokoro fp16, ADR 0003)', () => {
    expect(
      chooseDefault([
        r('kokoro', 'k', 'webgpu', 0.06, { audible: false }),
        r('kokoro', 'k', 'wasm', 0.4),
      ]),
    ).toEqual({ engineId: 'kokoro', modelId: 'k', backend: 'wasm' });
    expect(chooseDefault([r('kokoro', 'k', 'webgpu', 0.1, { error: 'boom' })])).toBeNull();
    expect(chooseDefault([])).toBeNull();
  });
  it('picks the fastest audible option when nothing is fast enough', () => {
    expect(
      chooseDefault([r('kokoro', 'k', 'wasm', 1.8), r('kokoro', 'k', 'webgpu', 1.2)])?.backend,
    ).toBe('webgpu');
  });
  it('describes results', () => {
    expect(describeResult(r('kokoro', 'k', 'webgpu', 0.106))).toBe(
      'Kokoro · WebGPU · 9.4× real time',
    );
    expect(describeResult(r('piper', 'p', 'wasm', 0))).toBe('Piper · WASM');
  });
  it('flags sustained starvation after 30 s', () => {
    const m = new RtfMonitor();
    expect(m.sample(1.2, 0)).toBe(false);
    expect(m.sample(1.1, 29_000)).toBe(false);
    expect(m.sample(1.0, 30_000)).toBe(true);
    expect(m.sample(0.5, 31_000)).toBe(false);
    expect(m.sample(1.0, 32_000)).toBe(false);
  });
});

describe('settings migration', () => {
  it('fills defaults and keeps valid fields from bad data', () => {
    expect(migrateSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(migrateSettings({ rate: 1.5 }).rate).toBe(1.5);
    const m = migrateSettings({
      rate: 99,
      pacing: 'brisk',
      voice: { engineId: 'kokoro', voice: 'af_heart' },
    });
    expect(m.rate).toBe(1);
    expect(m.pacing).toBe('brisk');
    expect(m.voice?.engineId).toBe('kokoro');
    expect(migrateSettings('nonsense')).toEqual(DEFAULT_SETTINGS);
  });
});
