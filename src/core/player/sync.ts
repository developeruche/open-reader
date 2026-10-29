/**
 * Timing sync protocol (PLAN.md §4.3). The engine host sends one SEGMENT_STARTED per segment plus a
 * few re-anchoring events; each visible context runs its own clock from them.
 */

export interface SyncWord {
  /** Media seconds within the segment. */
  start: number;
  end: number;
  /** Display range in the block's text. */
  displayStart: number;
  displayEnd: number;
  /** Index into the sentence's words, or -1. */
  sentenceWord: number;
}

export type SyncEvent =
  | {
      type: 'SEGMENT_STARTED';
      sessionId: string;
      segmentId: string;
      sentenceId: string;
      blockId: string;
      sentenceIndex: number;
      words: SyncWord[];
      mediaStartEpochMs: number;
      rate: number;
    }
  | { type: 'PAUSED'; sessionId: string; mediaTime: number }
  | { type: 'RESUMED'; sessionId: string; mediaStartEpochMs: number }
  | { type: 'RATE_CHANGED'; sessionId: string; rate: number; mediaTime: number; atEpochMs: number }
  | { type: 'SEEKED'; sessionId: string }
  | { type: 'SEGMENT_ENDED'; sessionId: string; segmentId: string }
  | {
      type: 'DRIFT';
      sessionId: string;
      mediaTime: number;
      atEpochMs: number;
      /** The re-anchor shortly after a segment starts, while Chrome's media clock settles. */
      settle?: boolean;
    };

/** Epoch at which media time 0 would have played, given media time `t` at `atEpochMs`. */
export function anchorFor(t: number, atEpochMs: number, rate: number): number {
  return atEpochMs - (t * 1000) / rate;
}

/** Follows the host's media clock in a visible context. */
export class ClockFollower {
  segment: Extract<SyncEvent, { type: 'SEGMENT_STARTED' }> | null = null;
  private anchor = 0;
  private rate = 1;
  private pausedAt: number | null = null;
  /** Between SEGMENT_ENDED/SEEKED and the next SEGMENT_STARTED: clock events belong to no segment. */
  private between = false;
  /** Highest word index shown in this segment: corrections never step the highlight back. */
  private shownWord = -1;
  /**
   * Largest gap seen between the predicted and the reported media clock, in ms (§9.1: ≤ 50).
   * Settle corrections are tracked apart: Chrome's clock runs ~64 ms, pauses ~63 ms, then runs
   * linearly after `playing`, so the first correction of each segment absorbs that (ADR 0017).
   */
  maxDriftMs = 0;
  maxSettleMs = 0;
  /** How many drift samples were compared. */
  driftSamples = 0;
  /** Recent drift samples in ms (newest last, at most 2000). */
  readonly drifts: number[] = [];

  apply(e: SyncEvent): void {
    switch (e.type) {
      case 'SEGMENT_STARTED':
        this.segment = e;
        this.anchor = e.mediaStartEpochMs;
        this.rate = e.rate;
        this.pausedAt = null;
        this.between = false;
        this.shownWord = -1;
        break;
      case 'PAUSED':
        this.pausedAt = e.mediaTime;
        break;
      case 'RESUMED':
        this.anchor = e.mediaStartEpochMs;
        this.pausedAt = null;
        break;
      case 'RATE_CHANGED':
        this.rate = e.rate;
        this.anchor = anchorFor(e.mediaTime, e.atEpochMs, e.rate);
        if (this.pausedAt !== null) this.pausedAt = e.mediaTime;
        break;
      case 'DRIFT':
        if (this.between) break;
        if (this.pausedAt === null && e.sessionId === this.segment?.sessionId && e.settle) {
          const drift = Math.abs(this.mediaTime(e.atEpochMs) - e.mediaTime) * 1000;
          this.maxSettleMs = Math.max(this.maxSettleMs, drift);
        } else if (this.pausedAt === null && e.sessionId === this.segment?.sessionId) {
          const drift = Math.abs(this.mediaTime(e.atEpochMs) - e.mediaTime) * 1000;
          this.maxDriftMs = Math.max(this.maxDriftMs, drift);
          this.driftSamples++;
          this.drifts.push(drift);
          if (this.drifts.length > 2000) this.drifts.shift();
        }
        if (this.pausedAt === null) this.anchor = anchorFor(e.mediaTime, e.atEpochMs, this.rate);
        else this.pausedAt = e.mediaTime;
        break;
      case 'SEEKED':
      case 'SEGMENT_ENDED':
        this.pausedAt = this.mediaTime(Date.now());
        this.between = true;
        if (e.type === 'SEEKED') this.shownWord = -1;
        break;
    }
  }

  get paused(): boolean {
    return this.pausedAt !== null;
  }

  mediaTime(nowMs: number): number {
    if (this.pausedAt !== null) return this.pausedAt;
    return Math.max(0, ((nowMs - this.anchor) * this.rate) / 1000);
  }

  /**
   * Index into segment.words of the word at `nowMs`, or -1 before the first word. Never lower
   * than an index already returned for this segment (a clock correction holds the word instead).
   */
  wordIndex(nowMs: number): number {
    this.shownWord = Math.max(this.shownWord, this.rawWordIndex(nowMs));
    return this.shownWord;
  }

  private rawWordIndex(nowMs: number): number {
    const words = this.segment?.words ?? [];
    const t = this.mediaTime(nowMs);
    let lo = 0;
    let hi = words.length - 1;
    let ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if ((words[mid]?.start ?? Infinity) <= t) {
        ans = mid;
        lo = mid + 1;
      } else hi = mid - 1;
    }
    return ans;
  }
}
