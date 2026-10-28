// Measures playback rate and dominant frequency of a 440 Hz tone played through
// HTMLAudioElement at several rates, to verify preservesPitch in the offscreen document.

export function sineWav(freq: number, seconds: number, sampleRate = 24000): Blob {
  const n = Math.floor(seconds * sampleRate);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const w = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * freq * i) / sampleRate) * 0.5 * 32767), true);
  return new Blob([buf], { type: 'audio/wav' });
}

export async function analyseRates(rates: number[]) {
  const url = URL.createObjectURL(sineWav(440, 30));
  const results = [];
  for (const rate of rates) {
    const a = new Audio(url);
    a.preservesPitch = true;
    a.playbackRate = rate;
    const ctx = new AudioContext();
    const stream = (a as HTMLAudioElement & { captureStream(): MediaStream }).captureStream();
    await a.play();
    await new Promise((r) => setTimeout(r, 300));
    const src = ctx.createMediaStreamSource(stream);
    const an = ctx.createAnalyser();
    an.fftSize = 16384;
    src.connect(an);
    const t0 = a.currentTime;
    const w0 = performance.now();
    await new Promise((r) => setTimeout(r, 1500));
    const bins = new Float32Array(an.frequencyBinCount);
    an.getFloatFrequencyData(bins);
    let best = 0;
    for (let i = 1; i < bins.length; i++) if ((bins[i] ?? -Infinity) > (bins[best] ?? -Infinity)) best = i;
    const freq = (best * ctx.sampleRate) / an.fftSize;
    const measuredRate = (a.currentTime - t0) / ((performance.now() - w0) / 1000);
    results.push({ rate, preservesPitch: a.preservesPitch, measuredRate: +measuredRate.toFixed(3), dominantHz: Math.round(freq), peakDb: Math.round(bins[best] ?? 0) });
    a.pause();
    await ctx.close();
  }
  return results;
}
