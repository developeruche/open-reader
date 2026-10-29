/**
 * Prefetch scheduler (PLAN.md §5.4.3): keeps audio ready ahead of the playhead, runs a bounded
 * number of jobs in priority order (distance from the playhead), and aborts stale work on seek.
 */
import { isAbort } from '../tts/engine';

export interface Wanted {
  key: string;
  /** Distance from the playhead; 0 is the segment playing next. */
  distance: number;
}

interface Slot<T> {
  key: string;
  distance: number;
  state: 'queued' | 'running' | 'ready' | 'failed';
  promise: Promise<T>;
  resolve(v: T): void;
  reject(e: unknown): void;
  controller?: AbortController;
  value?: T;
  error?: unknown;
}

export interface SchedulerStats {
  queued: number;
  running: number;
  ready: number;
  aborted: number;
  completed: number;
}

export class PrefetchScheduler<T> {
  private readonly slots = new Map<string, Slot<T>>();
  private running = 0;
  /** Called after a job's result becomes ready (the player re-plans its window). */
  onReady?: (key: string) => void;
  readonly stats: SchedulerStats = { queued: 0, running: 0, ready: 0, aborted: 0, completed: 0 };

  constructor(
    private readonly run: (key: string, signal: AbortSignal) => Promise<T>,
    private concurrency = 1,
    /** Ready results kept even when no longer wanted (recently played, for prev-sentence). */
    private readonly keepBehind = 4,
  ) {}

  setConcurrency(n: number): void {
    this.concurrency = Math.max(1, n);
    this.pump();
  }

  /**
   * Declares the wanted set. Queued or running jobs that are no longer wanted are aborted;
   * ready results beyond `keepBehind` unwanted ones are dropped.
   */
  want(list: Wanted[]): void {
    const wanted = new Map(list.map((w) => [w.key, w.distance]));
    const unwantedReady: string[] = [];
    for (const [key, slot] of this.slots) {
      const d = wanted.get(key);
      if (d !== undefined) {
        slot.distance = d;
        continue;
      }
      if (slot.state === 'queued' || slot.state === 'running') this.abort(slot);
      else if (slot.state === 'failed') this.slots.delete(key);
      else unwantedReady.push(key);
    }
    for (const key of unwantedReady.slice(0, Math.max(0, unwantedReady.length - this.keepBehind)))
      this.slots.delete(key);
    for (const w of list) if (!this.slots.has(w.key)) this.slots.set(w.key, this.slot(w));
    this.pump();
  }

  /** Resolves when the key is synthesized; queues it at distance 0 if unknown. */
  get(key: string): Promise<T> {
    let slot = this.slots.get(key);
    if (!slot || slot.state === 'failed') {
      slot = this.slot({ key, distance: 0 });
      this.slots.set(key, slot);
      this.pump();
    }
    return slot.promise;
  }

  peek(key: string): T | undefined {
    const s = this.slots.get(key);
    return s?.state === 'ready' ? s.value : undefined;
  }

  isReady(key: string): boolean {
    return this.slots.get(key)?.state === 'ready';
  }

  /** Aborts everything (voice change, document change). */
  reset(): void {
    for (const s of this.slots.values())
      if (s.state === 'queued' || s.state === 'running') this.abort(s);
    this.slots.clear();
  }

  snapshot(): SchedulerStats {
    let queued = 0;
    let ready = 0;
    for (const s of this.slots.values()) {
      if (s.state === 'queued') queued++;
      if (s.state === 'ready') ready++;
    }
    return { ...this.stats, queued, running: this.running, ready };
  }

  private slot(w: Wanted): Slot<T> {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    promise.catch(() => undefined); // callers that never await must not cause unhandled rejections
    return { key: w.key, distance: w.distance, state: 'queued', promise, resolve, reject };
  }

  private abort(slot: Slot<T>): void {
    if (slot.state === 'running') slot.controller?.abort();
    else this.slots.delete(slot.key);
    this.stats.aborted++;
    slot.reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
    this.slots.delete(slot.key);
  }

  private pump(): void {
    while (this.running < this.concurrency) {
      let next: Slot<T> | undefined;
      for (const s of this.slots.values())
        if (s.state === 'queued' && (!next || s.distance < next.distance)) next = s;
      if (!next) return;
      this.start(next);
    }
  }

  private start(slot: Slot<T>): void {
    slot.state = 'running';
    slot.controller = new AbortController();
    this.running++;
    const signal = slot.controller.signal;
    this.run(slot.key, signal).then(
      (v) => {
        this.running--;
        if (signal.aborted) return this.pump();
        slot.state = 'ready';
        slot.value = v;
        this.stats.completed++;
        slot.resolve(v);
        this.onReady?.(slot.key);
        this.pump();
      },
      (e: unknown) => {
        this.running--;
        if (!signal.aborted && !isAbort(e)) {
          slot.state = 'failed';
          slot.error = e;
          slot.reject(e);
        }
        this.pump();
      },
    );
  }
}
