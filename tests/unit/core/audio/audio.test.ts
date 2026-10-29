import { describe, expect, it } from 'vitest';
import {
  ampToDb,
  dbToAmp,
  normalizeLoudness,
  padEnd,
  peak,
  resampleLinear,
  rms,
  silentGaps,
  trimSilence,
} from '@/core/audio/dsp';
import { postProcess } from '@/core/audio/process';
import {
  boundaryError,
  estimateTimings,
  monotonic,
  shiftTimings,
  syllables,
  wordAt,
  type WordTiming,
} from '@/core/audio/timing';
import { decodeWav, encodeWav, floatToInt16, int16ToFloat } from '@/core/audio/wav';

const SR = 8000;
const silence = (s: number) => new Float32Array(Math.round(s * SR));
const tone = (s: number, amp = 0.3) =>
  Float32Array.from(
    { length: Math.round(s * SR) },
    (_, i) => amp * Math.sin((2 * Math.PI * 300 * i) / SR),
  );
const concat = (...parts: Float32Array[]) => {
  const out = new Float32Array(parts.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
};

describe('wav', () => {
  it('round-trips 16-bit mono', () => {
    const pcm = Float32Array.from([0, 0.5, -0.5, 1, -1, 2, Number.NaN]);
    const bytes = encodeWav(pcm, 24000);
    expect(bytes.length).toBe(44 + pcm.length * 2);
    const { pcm: back, sampleRate } = decodeWav(bytes);
    expect(sampleRate).toBe(24000);
    expect([...back]).toEqual([0, 16384, -16384, 32767, -32768, 32767, 0]);
    expect(int16ToFloat(back)[1]).toBeCloseTo(0.5, 3);
    expect([...floatToInt16(Float32Array.from([-1, 1]))]).toEqual([-32768, 32767]);
  });

  it('rejects non-WAV and unsupported formats', () => {
    expect(() => decodeWav(new Uint8Array(44))).toThrow('Not a WAV');
    const stereo = encodeWav(new Int16Array(4), 8000);
    new DataView(stereo.buffer).setUint16(22, 2, true);
    expect(() => decodeWav(stereo)).toThrow('Unsupported');
    const noData = encodeWav(new Int16Array(0), 8000).slice(0, 36);
    expect(() => decodeWav(noData)).toThrow('no data');
  });
});

describe('dsp', () => {
  it('converts dB and measures levels', () => {
    expect(dbToAmp(-20)).toBeCloseTo(0.1);
    expect(ampToDb(0.1)).toBeCloseTo(-20);
    expect(ampToDb(0)).toBe(-Infinity);
    expect(rms(new Float32Array(0))).toBe(0);
    expect(peak(Float32Array.from([0.1, -0.7, 0.3]))).toBeCloseTo(0.7);
  });

  it('trims silence keeping a 30 ms margin', () => {
    const pcm = concat(silence(0.5), tone(1), silence(0.4));
    const t = trimSilence(pcm, SR);
    expect(t.trimmedStart / SR).toBeCloseTo(0.5 - 0.03, 2);
    expect(t.trimmedEnd / SR).toBeCloseTo(0.4 - 0.03, 2);
    expect(t.pcm.length / SR).toBeCloseTo(1.06, 2);
  });

  it('trims everything when the clip is silent', () => {
    const t = trimSilence(silence(0.2), SR);
    expect(t.pcm.length).toBe(0);
  });

  it('normalizes RMS toward −20 dBFS under a −1.5 dBFS peak ceiling', () => {
    const quiet = tone(1, 0.01);
    const { pcm } = normalizeLoudness(quiet);
    expect(ampToDb(rms(pcm))).toBeCloseTo(-20, 1);
    const spiky = concat(tone(1, 0.01), Float32Array.from([0.9]));
    const r = normalizeLoudness(spiky);
    expect(ampToDb(peak(r.pcm))).toBeLessThanOrEqual(-1.5 + 1e-6);
    expect(normalizeLoudness(silence(0.1)).gain).toBe(1);
  });

  it('pads, resamples and finds gaps', () => {
    expect(padEnd(tone(0.1), SR, 0.22).length).toBe(Math.round(0.1 * SR) + Math.round(0.22 * SR));
    expect(resampleLinear(tone(1), 8000, 16000).length).toBe(16000);
    expect(resampleLinear(tone(1), 8000, 8000).length).toBe(8000);
    const gaps = silentGaps(
      concat(tone(0.3), silence(0.15), tone(0.3), silence(0.05), tone(0.2)),
      SR,
    );
    expect(gaps).toHaveLength(1);
    expect(gaps[0]![0]).toBeCloseTo(0.3, 1);
    expect(gaps[0]![1]).toBeCloseTo(0.45, 1);
  });
});

describe('timing shift math', () => {
  const words: WordTiming[] = [
    { charStart: 0, charEnd: 5, start: 0.5, end: 0.9 },
    { charStart: 6, charEnd: 11, start: 0.95, end: 1.4 },
  ];

  it('shifts and clamps', () => {
    expect(shiftTimings(words, -0.47, 1)).toEqual([
      { charStart: 0, charEnd: 5, start: expect.closeTo(0.03), end: expect.closeTo(0.43) },
      { charStart: 6, charEnd: 11, start: expect.closeTo(0.48), end: expect.closeTo(0.93) },
    ]);
    expect(shiftTimings(words, -2, 1).every((w) => w.start === 0 && w.end === 0)).toBe(true);
  });

  it('postProcess keeps timings on the same audio after trim and pause', () => {
    const pcm = concat(silence(0.5), tone(0.4), silence(0.05), tone(0.45), silence(0.6));
    const out = postProcess(pcm, SR, words, { pauseAfter: 0.7 });
    // Leading silence 0.5 s trimmed to a 30 ms margin → timings move by −0.47 s.
    expect(out.words[0]!.start).toBeCloseTo(0.03, 2);
    expect(out.words[1]!.end).toBeCloseTo(0.93, 2);
    expect(out.speechEnd).toBeCloseTo(0.4 + 0.05 + 0.45 + 0.06, 2);
    expect(out.duration).toBeCloseTo(out.speechEnd + 0.7, 2);
    // The audio at each word start is voiced.
    const at = (t: number) =>
      Math.abs(out.pcm[Math.round((t + 0.05) * SR)] ?? 0) > 0 ||
      rms(out.pcm, Math.round(t * SR), Math.round((t + 0.1) * SR)) > 0.01;
    expect(at(out.words[0]!.start)).toBe(true);
    expect(at(out.words[1]!.start)).toBe(true);
    expect(
      postProcess(pcm, SR, words, { pauseAfter: 0, loudness: false }).pcm.length,
    ).toBeGreaterThan(0);
  });

  it('monotonic fixes overlaps', () => {
    const m = monotonic([
      { charStart: 0, charEnd: 1, start: 0.5, end: 0.4 },
      { charStart: 2, charEnd: 3, start: 0.3, end: 0.6 },
    ]);
    expect(m[0]).toMatchObject({ start: 0.5, end: 0.5 });
    expect(m[1]).toMatchObject({ start: 0.5, end: 0.6 });
  });
});

describe('estimated timings', () => {
  it('counts syllables roughly', () => {
    expect(syllables('cat')).toBe(1);
    expect(syllables('transaction')).toBe(3);
    expect(syllables('make')).toBe(1);
    expect(syllables('P')).toBe(1);
    expect(syllables('2024')).toBe(6);
    expect(syllables('!!')).toBe(1);
  });

  it('distributes the voiced span by weight and stays monotonic and inside the audio', () => {
    const spoken = 'Hello world, this is a transaction.';
    const words = [...spoken.matchAll(/\w+/g)].map((m) => ({
      start: m.index,
      end: m.index + m[0].length,
    }));
    const est = estimateTimings({ spoken, words, voicedStart: 0.1, voicedEnd: 3.1 });
    expect(est).toHaveLength(words.length);
    expect(est[0]!.start).toBeCloseTo(0.1);
    expect(est.at(-1)!.end).toBeLessThanOrEqual(3.1 + 1e-9);
    for (let i = 1; i < est.length; i++)
      expect(est[i]!.start).toBeGreaterThanOrEqual(est[i - 1]!.end - 1e-9);
    // The comma after "world" leaves a pause before "this".
    expect(est[2]!.start - est[1]!.end).toBeGreaterThan(0.1);
    expect(estimateTimings({ spoken: '', words: [], voicedStart: 0, voicedEnd: 1 })).toEqual([]);
  });

  it('snaps word ends before punctuation to real silences', () => {
    const spoken = 'one two, three';
    const words = [
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 9, end: 14 },
    ];
    const pcm = concat(tone(0.6), silence(0.25), tone(0.5));
    const est = estimateTimings({
      spoken,
      words,
      voicedStart: 0,
      voicedEnd: pcm.length / SR,
      pcm,
      sampleRate: SR,
    });
    expect(est[1]!.end).toBeCloseTo(0.6, 1);
    expect(est[2]!.start).toBeCloseTo(0.85, 1);
  });

  it('wordAt and boundaryError', () => {
    const w: WordTiming[] = [
      { charStart: 0, charEnd: 1, start: 0, end: 0.5 },
      { charStart: 2, charEnd: 3, start: 0.5, end: 1 },
    ];
    expect(wordAt(w, -1)).toBe(-1);
    expect(wordAt(w, 0.2)).toBe(0);
    expect(wordAt(w, 0.7)).toBe(1);
    expect(boundaryError(w, w)).toBe(0);
    expect(boundaryError(w, shiftTimings(w, 0.1, 9))).toBeCloseTo(0.1);
    expect(boundaryError([], w)).toBe(0);
  });
});
