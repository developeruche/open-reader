/**
 * Rewrites an ONNX model so its large initializers become external data that points back into the
 * original bytes (ADR 0018). onnxruntime-web then uploads WebGPU weights straight from that buffer
 * instead of copying the whole model into its WASM heap, which never shrinks (757 MB → 33 MB for
 * Kokoro fp32). Only the graph (≈ 1 MB) is rebuilt; the weights are never copied.
 *
 * ONNX is protobuf: ModelProto.graph = 7, GraphProto.initializer = 5, TensorProto.raw_data = 9,
 * TensorProto.external_data = 13 (StringStringEntryProto: key = 1, value = 2),
 * TensorProto.data_location = 14 (EXTERNAL = 1).
 */

const LEN = 2;

interface Field {
  num: number;
  wire: number;
  /** Byte range of the whole field (tag included). */
  start: number;
  end: number;
  /** Payload range for length-delimited fields. */
  dataStart: number;
  dataEnd: number;
}

function readVarint(b: Uint8Array, pos: number): [number, number] {
  let v = 0;
  let mul = 1;
  for (;;) {
    const byte = b[pos++];
    if (byte === undefined) throw new Error('Truncated ONNX model');
    v += (byte & 0x7f) * mul;
    if (byte < 0x80) return [v, pos];
    mul *= 128;
  }
}

function* fields(b: Uint8Array, from: number, to: number): Generator<Field> {
  let pos = from;
  while (pos < to) {
    const start = pos;
    const [tag, p] = readVarint(b, pos);
    pos = p;
    const num = Math.floor(tag / 8);
    const wire = tag & 7;
    let dataStart = pos;
    let dataEnd = pos;
    if (wire === 0) [, pos] = readVarint(b, pos);
    else if (wire === 1) pos += 8;
    else if (wire === 5) pos += 4;
    else if (wire === LEN) {
      const [len, q] = readVarint(b, pos);
      dataStart = q;
      dataEnd = q + len;
      pos = dataEnd;
    } else throw new Error(`Unsupported protobuf wire type ${wire}`);
    if (pos > to) throw new Error('Truncated ONNX model');
    yield { num, wire, start, end: pos, dataStart, dataEnd };
  }
}

function varint(n: number): number[] {
  const out: number[] = [];
  let v = n;
  while (v >= 0x80) {
    out.push((v % 128) | 0x80);
    v = Math.floor(v / 128);
  }
  out.push(v);
  return out;
}

const text = new TextEncoder();

/** Concatenates byte pieces into one array. */
class Builder {
  private readonly parts: Uint8Array[] = [];
  length = 0;
  push(p: Uint8Array | number[]): void {
    const u = p instanceof Uint8Array ? p : Uint8Array.from(p);
    this.parts.push(u);
    this.length += u.length;
  }
  lenField(num: number, payload: Uint8Array): void {
    this.push(varint(num * 8 + LEN));
    this.push(varint(payload.length));
    this.push(payload);
  }
  bytes(): Uint8Array {
    const out = new Uint8Array(this.length);
    let o = 0;
    for (const p of this.parts) {
      out.set(p, o);
      o += p.length;
    }
    return out;
  }
}

function entry(key: string, value: string): Uint8Array {
  const e = new Builder();
  e.lenField(1, text.encode(key));
  e.lenField(2, text.encode(value));
  return e.bytes();
}

export interface Externalized {
  /** The model without large initializer payloads. */
  graph: Uint8Array;
  /** Initializers moved out, and the bytes they point at. */
  moved: number;
  movedBytes: number;
}

/**
 * `location` names the external data file; pass the original model bytes under that name
 * (`externalData: [{ path: location, data: model }]`).
 */
export function externalizeInitializers(
  model: Uint8Array,
  location: string,
  threshold = 1024,
): Externalized {
  let moved = 0;
  let movedBytes = 0;
  const out = new Builder();
  for (const f of fields(model, 0, model.length)) {
    if (f.num !== 7 || f.wire !== LEN) {
      out.push(model.subarray(f.start, f.end));
      continue;
    }
    const graph = new Builder();
    for (const g of fields(model, f.dataStart, f.dataEnd)) {
      if (g.num !== 5 || g.wire !== LEN) {
        graph.push(model.subarray(g.start, g.end));
        continue;
      }
      let raw: Field | undefined;
      let external = false;
      for (const t of fields(model, g.dataStart, g.dataEnd)) {
        if (t.num === 9 && t.wire === LEN) raw = t;
        if (t.num === 14 || t.num === 13) external = true;
      }
      if (!raw || external || raw.dataEnd - raw.dataStart < threshold) {
        graph.push(model.subarray(g.start, g.end));
        continue;
      }
      const tensor = new Builder();
      for (const t of fields(model, g.dataStart, g.dataEnd))
        if (t.start !== raw.start) tensor.push(model.subarray(t.start, t.end));
      tensor.lenField(13, entry('location', location));
      tensor.lenField(13, entry('offset', String(raw.dataStart)));
      tensor.lenField(13, entry('length', String(raw.dataEnd - raw.dataStart)));
      tensor.push(varint(14 * 8));
      tensor.push([1]);
      graph.lenField(5, tensor.bytes());
      moved++;
      movedBytes += raw.dataEnd - raw.dataStart;
    }
    out.lenField(7, graph.bytes());
  }
  return { graph: out.bytes(), moved, movedBytes };
}

/**
 * What to hand `InferenceSession.create` for a model: on WebGPU the rewritten graph plus the
 * original bytes as external data; elsewhere (or if the model can't be parsed) the bytes as is.
 */
export function sessionInput(
  bytes: Uint8Array,
  backend: string,
  name = 'model.onnx',
): { model: Uint8Array; externalData?: { path: string; data: Uint8Array }[] } {
  if (backend !== 'webgpu') return { model: bytes };
  try {
    const { graph, moved } = externalizeInitializers(bytes, name);
    return moved ? { model: graph, externalData: [{ path: name, data: bytes }] } : { model: bytes };
  } catch {
    return { model: bytes };
  }
}
