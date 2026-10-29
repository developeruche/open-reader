/**
 * Loudness for audiobook export (PLAN.md M11): ITU-R BS.1770-4 integrated loudness (K-weighting,
 * 400 ms blocks every 100 ms, −70 LUFS absolute and −10 LU relative gates), true peak by 4×
 * oversampling (BS.1770-4 Annex 2), and a look-ahead peak limiter. All streaming, mono.
 */

/** Integrated loudness and true-peak targets of the owner's PSBT audiobook. */
export const EXPORT_LUFS = -17;
export const EXPORT_TRUE_PEAK_DB = -1.5;

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** K-weighting for any sample rate (pre-filter shelf + RLB high-pass, as in libebur128). */
export function kWeighting(sampleRate: number): [Biquad, Biquad] {
  let f0 = 1681.974450955533;
  const G = 3.999843853973347;
  let Q = 0.7071752369554196;
  let K = Math.tan((Math.PI * f0) / sampleRate);
  const Vh = 10 ** (G / 20);
  const Vb = Vh ** 0.4996667741545416;
  let a0 = 1 + K / Q + K * K;
  const shelf: Biquad = {
    b0: (Vh + (Vb * K) / Q + K * K) / a0,
    b1: (2 * (K * K - Vh)) / a0,
    b2: (Vh - (Vb * K) / Q + K * K) / a0,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  f0 = 38.13547087602444;
  Q = 0.5003270373238773;
  K = Math.tan((Math.PI * f0) / sampleRate);
  a0 = 1 + K / Q + K * K;
  const highPass: Biquad = {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (K * K - 1)) / a0,
    a2: (1 - K / Q + K * K) / a0,
  };
  return [shelf, highPass];
}

const toDb = (x: number) => (x > 0 ? 20 * Math.log10(x) : -Infinity);

/** Streaming BS.1770 integrated loudness meter. */
export class LoudnessMeter {
  private readonly filters: [Biquad, Biquad];
  private readonly state = new Float64Array(8);
  private readonly stepSamples: number;
  private stepSum = 0;
  private stepCount = 0;
  /** Mean square of each 100 ms step; 400 ms blocks are four consecutive steps. */
  private readonly steps: number[] = [];

  constructor(readonly sampleRate: number) {
    this.filters = kWeighting(sampleRate);
    this.stepSamples = Math.round(sampleRate / 10);
  }

  push(pcm: Float32Array): void {
    const [f1, f2] = this.filters;
    const s = this.state;
    for (let i = 0; i < pcm.length; i++) {
      const x = pcm[i] ?? 0;
      // Direct form I, two cascaded biquads.
      const y1 =
        f1.b0 * x +
        f1.b1 * (s[0] ?? 0) +
        f1.b2 * (s[1] ?? 0) -
        f1.a1 * (s[2] ?? 0) -
        f1.a2 * (s[3] ?? 0);
      s[1] = s[0] ?? 0;
      s[0] = x;
      s[3] = s[2] ?? 0;
      s[2] = y1;
      const y2 =
        f2.b0 * y1 +
        f2.b1 * (s[4] ?? 0) +
        f2.b2 * (s[5] ?? 0) -
        f2.a1 * (s[6] ?? 0) -
        f2.a2 * (s[7] ?? 0);
      s[5] = s[4] ?? 0;
      s[4] = y1;
      s[7] = s[6] ?? 0;
      s[6] = y2;
      this.stepSum += y2 * y2;
      if (++this.stepCount === this.stepSamples) {
        this.steps.push(this.stepSum / this.stepSamples);
        this.stepSum = 0;
        this.stepCount = 0;
      }
    }
  }

  /** Integrated loudness in LUFS (−Infinity for silence or under 400 ms). */
  integrated(): number {
    const blocks: number[] = [];
    for (let i = 0; i + 4 <= this.steps.length; i++)
      blocks.push(
        ((this.steps[i] ?? 0) +
          (this.steps[i + 1] ?? 0) +
          (this.steps[i + 2] ?? 0) +
          (this.steps[i + 3] ?? 0)) /
          4,
      );
    const lufs = (ms: number) => -0.691 + 10 * Math.log10(ms);
    const loud = blocks.filter((z) => z > 0 && lufs(z) > -70);
    if (!loud.length) return -Infinity;
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const relative = lufs(mean(loud)) - 10;
    const gated = loud.filter((z) => lufs(z) > relative);
    return gated.length ? lufs(mean(gated)) : -Infinity;
  }
}

/** BS.1770-4 Annex 2 polyphase interpolation filter (4 phases × 12 taps). */
const TP_PHASES = [
  [
    0.001708984375, 0.010986328125, -0.0196533203125, 0.033203125, -0.0594482421875,
    0.1373291015625, 0.97216796875, -0.102294921875, 0.047607421875, -0.026611328125,
    0.014892578125, -0.00830078125,
  ],
  [
    -0.0291748046875, 0.029296875, -0.0517578125, 0.089111328125, -0.16650390625, 0.465087890625,
    0.77978515625, -0.2003173828125, 0.1015625, -0.0582275390625, 0.0330810546875, -0.0189208984375,
  ],
  [
    -0.0189208984375, 0.0330810546875, -0.0582275390625, 0.1015625, -0.2003173828125, 0.77978515625,
    0.465087890625, -0.16650390625, 0.089111328125, -0.0517578125, 0.029296875, -0.0291748046875,
  ],
  [
    -0.00830078125, 0.014892578125, -0.026611328125, 0.047607421875, -0.102294921875, 0.97216796875,
    0.1373291015625, -0.0594482421875, 0.033203125, -0.0196533203125, 0.010986328125,
    0.001708984375,
  ],
];
const TAPS = 12;

/** Streaming true-peak meter (dBTP). */
export class TruePeakMeter {
  private readonly history = new Float64Array(TAPS);
  private pos = 0;
  private peak = 0;

  push(pcm: Float32Array): void {
    const h = this.history;
    for (let i = 0; i < pcm.length; i++) {
      const x = pcm[i] ?? 0;
      h[this.pos] = x;
      this.pos = (this.pos + 1) % TAPS;
      this.peak = Math.max(this.peak, Math.abs(x));
      for (const phase of TP_PHASES) {
        let acc = 0;
        for (let k = 0; k < TAPS; k++)
          acc += (phase[k] ?? 0) * (h[(this.pos + TAPS - 1 - k) % TAPS] ?? 0);
        const a = Math.abs(acc);
        if (a > this.peak) this.peak = a;
      }
    }
  }

  get dbtp(): number {
    return toDb(this.peak);
  }
}

/**
 * Look-ahead peak limiter: each output sample gets the smallest gain any sample in the next
 * `lookaheadMs` needs to stay under `ceilingDb`, recovering linearly over `releaseMs`. Output is
 * delayed by the look-ahead; `flush()` drains the tail.
 */
export class PeakLimiter {
  private readonly ceiling: number;
  private readonly lookahead: number;
  private readonly release: number;
  private readonly delay: Float32Array;
  private readonly need: Float32Array;
  private written = 0;
  private gain = 1;
  /** Monotonic deque of indices into the ring, by required gain ascending. */
  private deque: number[] = [];

  constructor(
    sampleRate: number,
    ceilingDb = EXPORT_TRUE_PEAK_DB - 0.5,
    lookaheadMs = 5,
    releaseMs = 80,
  ) {
    this.ceiling = 10 ** (ceilingDb / 20);
    this.lookahead = Math.max(1, Math.round((sampleRate * lookaheadMs) / 1000));
    this.release = 1 / Math.max(1, Math.round((sampleRate * releaseMs) / 1000));
    this.delay = new Float32Array(this.lookahead + 1);
    this.need = new Float32Array(this.lookahead + 1);
  }

  private step(x: number, out: number[]): void {
    const n = this.delay.length;
    const i = this.written % n;
    this.delay[i] = x;
    const req = Math.abs(x) > this.ceiling ? this.ceiling / Math.abs(x) : 1;
    this.need[i] = req;
    while (this.deque.length && (this.need[this.deque[this.deque.length - 1] ?? 0] ?? 1) >= req)
      this.deque.pop();
    this.deque.push(i);
    this.written++;
    if (this.written <= this.lookahead) return;
    // The sample leaving the delay line is `lookahead` behind; drop deque entries older than it.
    const outIndex = (this.written - 1 - this.lookahead) % n;
    const target = this.need[this.deque[0] ?? 0] ?? 1;
    this.gain = target < this.gain ? target : Math.min(target, this.gain + this.release);
    out.push((this.delay[outIndex] ?? 0) * this.gain);
    if (this.deque[0] === outIndex) this.deque.shift();
  }

  process(pcm: Float32Array): Float32Array {
    const out: number[] = [];
    for (let i = 0; i < pcm.length; i++) this.step(pcm[i] ?? 0, out);
    return Float32Array.from(out);
  }

  flush(): Float32Array {
    const out: number[] = [];
    for (let i = 0; i < this.lookahead; i++) this.step(0, out);
    return Float32Array.from(out);
  }
}

/** Linear gain that moves `lufs` to `target` (1 for silence). */
export function gainFor(lufs: number, target = EXPORT_LUFS): number {
  return Number.isFinite(lufs) ? 10 ** ((target - lufs) / 20) : 1;
}
