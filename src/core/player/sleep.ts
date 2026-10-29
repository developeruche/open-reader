/**
 * Sleep timer (PLAN.md M11): pause after a number of minutes, or at the end of the current section
 * (the next heading). It is checked at each sentence boundary, so the voice never stops mid-word.
 */
import type { Navigator } from '../document/positions';

export type SleepChoice = { kind: 'minutes'; minutes: number } | { kind: 'section' };

export type SleepTimer =
  | { kind: 'minutes'; at: number }
  /** Pause when reading leaves the section that starts at this block index (−1: before any heading). */
  | { kind: 'section'; section: number };

/** Block index of the heading the sentence belongs under, or −1 before the first heading. */
export function sectionOf(nav: Navigator, sentence: number): number {
  const ref = nav.at(sentence);
  if (!ref) return -1;
  for (let s = sentence; s >= 0; s--) {
    const r = nav.at(s);
    if (r?.block.type === 'heading') return r.blockIndex;
  }
  return -1;
}

export function startSleep(
  choice: SleepChoice,
  now: number,
  nav: Navigator,
  sentence: number,
): SleepTimer {
  return choice.kind === 'minutes'
    ? { kind: 'minutes', at: now + choice.minutes * 60_000 }
    : { kind: 'section', section: sectionOf(nav, sentence) };
}

/** States that settle the timer; buffering and seeking between segments leave it alone. */
export const SLEEP_SETTLED_STATES = new Set(['playing', 'paused', 'idle', 'ended', 'error']);

/**
 * At a sentence boundary: 'fire' pauses now, 'expire' drops a minutes timer that ran out while
 * paused, 'keep' leaves it running.
 */
export function checkSleep(
  t: SleepTimer,
  o: { now: number; nav: Navigator; sentence: number; playing: boolean },
): 'fire' | 'expire' | 'keep' {
  if (t.kind === 'minutes') {
    if (o.now < t.at) return 'keep';
    return o.playing ? 'fire' : 'expire';
  }
  return o.playing && sectionOf(o.nav, o.sentence) !== t.section ? 'fire' : 'keep';
}
