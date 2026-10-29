/** 16-bit PCM WAV encode/decode and sample conversion (mono). */

export function floatToInt16(pcm: Float32Array): Int16Array {
  const out = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i] ?? 0));
    out[i] = Number.isNaN(v) ? 0 : Math.round(v < 0 ? v * 0x8000 : v * 0x7fff);
  }
  return out;
}

export function int16ToFloat(pcm: Int16Array): Float32Array {
  const out = new Float32Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i] ?? 0;
    out[i] = v < 0 ? v / 0x8000 : v / 0x7fff;
  }
  return out;
}

export function encodeWav(pcm: Float32Array | Int16Array, sampleRate: number): Uint8Array {
  const samples = pcm instanceof Int16Array ? pcm : floatToInt16(pcm);
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) v.setInt16(44 + i * 2, samples[i] ?? 0, true);
  return new Uint8Array(buf);
}

export function decodeWav(bytes: Uint8Array): { pcm: Int16Array; sampleRate: number } {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o: number) => String.fromCharCode(...bytes.subarray(o, o + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE') throw new Error('Not a WAV file');
  let o = 12;
  let sampleRate = 0;
  let bits = 0;
  let channels = 0;
  while (o + 8 <= bytes.length) {
    const id = tag(o);
    const size = v.getUint32(o + 4, true);
    if (id === 'fmt ') {
      channels = v.getUint16(o + 10, true);
      sampleRate = v.getUint32(o + 12, true);
      bits = v.getUint16(o + 22, true);
    } else if (id === 'data') {
      if (bits !== 16 || channels !== 1)
        throw new Error(`Unsupported WAV: ${channels} ch, ${bits} bit`);
      const n = Math.floor(Math.min(size, bytes.length - o - 8) / 2);
      const pcm = new Int16Array(n);
      for (let i = 0; i < n; i++) pcm[i] = v.getInt16(o + 8 + i * 2, true);
      return { pcm, sampleRate };
    }
    o += 8 + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/**
 * Header for a streamed 16-bit mono WAV of `samples` samples, followed later by an optional
 * `id3 ` chunk of `id3Bytes` (players such as VLC and foobar2000 read tags and chapters there).
 */
export function wavHeader(samples: number, sampleRate: number, id3Bytes = 0): Uint8Array {
  const data = samples * 2;
  const tail = id3Bytes ? 8 + id3Bytes + (id3Bytes % 2) : 0;
  const v = new DataView(new ArrayBuffer(44));
  const ascii = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  v.setUint32(4, 36 + data + (data % 2) + tail, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  ascii(36, 'data');
  v.setUint32(40, data, true);
  return new Uint8Array(v.buffer);
}

/** The `id3 ` RIFF chunk that follows the data chunk (padded to an even length). */
export function wavId3Chunk(tag: Uint8Array): Uint8Array {
  const out = new Uint8Array(8 + tag.length + (tag.length % 2));
  out.set([0x69, 0x64, 0x33, 0x20]); // "id3 "
  new DataView(out.buffer).setUint32(4, tag.length, true);
  out.set(tag, 8);
  return out;
}
