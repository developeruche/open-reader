import { describe, expect, it } from 'vitest';
import {
  EXPORT_LUFS,
  EXPORT_TRUE_PEAK_DB,
  gainFor,
  LoudnessMeter,
  PeakLimiter,
  TruePeakMeter,
} from '@/core/audio/loudness';

const sine = (freq: number, amp: number, seconds: number, sr: number, phase = 0) =>
  Float32Array.from(
    { length: Math.round(seconds * sr) },
    (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / sr + phase),
  );
const db = (x: number) => 20 * Math.log10(x);

describe('LoudnessMeter (BS.1770-4)', () => {
  it.each([48000, 24000, 22050])('a 997 Hz sine at −23 dBFS reads −26 LUFS mono at %d Hz', (sr) => {
    const m = new LoudnessMeter(sr);
    const s = sine(997, 10 ** (-23 / 20), 5, sr);
    // Streaming in odd-sized chunks gives the same answer as one push.
    for (let i = 0; i < s.length; i += 7919) m.push(s.subarray(i, i + 7919));
    expect(m.integrated()).toBeCloseTo(-26.01, 1);
  });

  it('gates silence and quiet passages', () => {
    const sr = 24000;
    const m = new LoudnessMeter(sr);
    m.push(sine(997, 10 ** (-23 / 20), 4, sr));
    m.push(new Float32Array(sr * 20)); // 20 s of silence: below the absolute gate
    m.push(sine(997, 10 ** (-60 / 20), 4, sr)); // far below the relative gate
    expect(m.integrated()).toBeCloseTo(-26.01, 0);
    expect(new LoudnessMeter(sr).integrated()).toBe(-Infinity);
  });

  it('gain moves loudness to the export target', () => {
    expect(gainFor(-20)).toBeCloseTo(10 ** (3 / 20), 6);
    expect(gainFor(-Infinity)).toBe(1);
    expect(EXPORT_LUFS).toBe(-17);
  });
});

describe('TruePeakMeter', () => {
  it('finds inter-sample peaks above the sample peak', () => {
    // fs/4 sine at 45°: every sample sits at 0.707 of the true peak.
    const sr = 48000;
    const s = sine(sr / 4, 1, 0.1, sr, Math.PI / 4);
    const samplePeak = Math.max(...s.map(Math.abs));
    const tp = new TruePeakMeter();
    tp.push(s);
    expect(db(samplePeak)).toBeCloseTo(-3.01, 1);
    expect(tp.dbtp).toBeGreaterThan(-0.5);
  });
});

describe('PeakLimiter', () => {
  it('keeps the output under the ceiling without changing length or quiet audio', () => {
    const sr = 24000;
    const loud = sine(440, 1.4, 1, sr);
    const quiet = sine(440, 0.1, 1, sr);
    const lim = new PeakLimiter(sr);
    const out = new Float32Array([...lim.process(quiet), ...lim.process(loud), ...lim.flush()]);
    expect(out.length).toBe(quiet.length + loud.length);
    const tp = new TruePeakMeter();
    tp.push(out);
    expect(tp.dbtp).toBeLessThanOrEqual(EXPORT_TRUE_PEAK_DB);
    // Quiet audio passes through untouched (delayed by the look-ahead only).
    for (let i = 0; i < 2000; i++) expect(out[i + 1000]).toBeCloseTo(quiet[i + 1000] ?? 0, 6);
  });
});
