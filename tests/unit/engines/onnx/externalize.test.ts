import { describe, expect, it } from 'vitest';
import { externalizeInitializers, sessionInput } from '@/engines/onnx/externalize';

// A tiny hand-encoded protobuf writer for ONNX-shaped test models.
const varint = (n: number) => {
  const out: number[] = [];
  while (n >= 0x80) {
    out.push((n % 128) | 0x80);
    n = Math.floor(n / 128);
  }
  out.push(n);
  return out;
};
const len = (num: number, payload: number[]) => [
  ...varint(num * 8 + 2),
  ...varint(payload.length),
  ...payload,
];
const vint = (num: number, v: number) => [...varint(num * 8), ...varint(v)];
const str = (s: string) => [...new TextEncoder().encode(s)];
const tensor = (name: string, raw: number[]) => [
  ...vint(1, raw.length / 4),
  ...vint(2, 1),
  ...len(8, str(name)),
  ...len(9, raw),
];

function model(): Uint8Array {
  const big = Array.from({ length: 2048 }, (_, i) => i & 0xff);
  const graph = [
    ...len(1, str('node')), // a NodeProto stand-in, copied as is
    ...len(2, str('g')),
    ...len(5, tensor('big', big)),
    ...len(5, tensor('small', [1, 2, 3, 4])),
  ];
  return Uint8Array.from([...vint(1, 8), ...len(8, [...vint(2, 17)]), ...len(7, graph)]);
}

/** Minimal reader for assertions: top-level fields of a message. */
function read(b: Uint8Array, from = 0, to = b.length) {
  const out: { num: number; data: Uint8Array; start: number }[] = [];
  let p = from;
  const vi = () => {
    let v = 0;
    let m = 1;
    for (;;) {
      const x = b[p++]!;
      v += (x & 0x7f) * m;
      if (x < 0x80) return v;
      m *= 128;
    }
  };
  while (p < to) {
    const tag = vi();
    const wire = tag & 7;
    if (wire === 0) {
      const s = p;
      vi();
      out.push({ num: tag >> 3, data: b.subarray(s, p), start: s });
    } else {
      const l = vi();
      out.push({ num: tag >> 3, data: b.subarray(p, p + l), start: p });
      p += l;
    }
  }
  return out;
}

describe('externalizeInitializers', () => {
  it('points large initializers at their bytes in the original model and keeps the rest', () => {
    const m = model();
    const { graph, moved, movedBytes } = externalizeInitializers(m, 'model.onnx');
    expect(moved).toBe(1);
    expect(movedBytes).toBe(2048);
    expect(graph.length).toBeLessThan(m.length - 1900);
    const top = read(graph);
    expect(top.map((f) => f.num)).toEqual([1, 8, 7]);
    const g = top[2]!;
    const inits = read(graph, g.start, g.start + g.data.length).filter((f) => f.num === 5);
    const [big, small] = inits.map((f) => read(graph, f.start, f.start + f.data.length));
    expect(big!.some((f) => f.num === 9)).toBe(false);
    const ext = Object.fromEntries(
      big!
        .filter((f) => f.num === 13)
        .map((f) => {
          const kv = read(graph, f.start, f.start + f.data.length);
          return [new TextDecoder().decode(kv[0]!.data), new TextDecoder().decode(kv[1]!.data)];
        }),
    );
    expect(ext.location).toBe('model.onnx');
    const off = Number(ext.offset);
    expect(Array.from(m.subarray(off, off + Number(ext.length)))).toEqual(
      Array.from({ length: 2048 }, (_, i) => i & 0xff),
    );
    expect(big!.find((f) => f.num === 14)?.data[0]).toBe(1);
    // Small initializers stay inline.
    expect(small!.find((f) => f.num === 9)?.data.length).toBe(4);
  });

  it('rejects truncated input and falls back to the bytes as is', () => {
    const m = model().subarray(0, 40);
    expect(() => externalizeInitializers(m, 'x')).toThrow(/Truncated/);
    expect(sessionInput(m, 'webgpu').model).toBe(m);
    expect(sessionInput(model(), 'wasm').externalData).toBeUndefined();
    const s = sessionInput(model(), 'webgpu');
    expect(s.externalData?.[0]?.path).toBe('model.onnx');
  });
});
