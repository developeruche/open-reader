import { describe, expect, it } from 'vitest';
import { buildBlock } from '@/core/document/build';
import { Navigator } from '@/core/document/positions';
import { checkSleep, sectionOf, startSleep } from '@/core/player/sleep';

const nav = new Navigator({
  id: 'd',
  kind: 'web',
  title: 'T',
  lang: 'en',
  blocks: [
    buildBlock({ id: 'p0', type: 'paragraph', text: 'Before. Any heading.' }),
    buildBlock({ id: 'h1', type: 'heading', level: 1, text: 'One' }),
    buildBlock({ id: 'p1', type: 'paragraph', text: 'First. Second.' }),
    buildBlock({ id: 'h2', type: 'heading', level: 1, text: 'Two' }),
    buildBlock({ id: 'p2', type: 'paragraph', text: 'Third.' }),
  ],
});

describe('sleep timer', () => {
  it('finds the section of a sentence', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map((s) => sectionOf(nav, s))).toEqual([-1, -1, 1, 1, 1, 3, 3]);
    expect(sectionOf(nav, 99)).toBe(-1);
  });

  it('fires after the minutes pass, at a sentence boundary, only while playing', () => {
    const t = startSleep({ kind: 'minutes', minutes: 10 }, 1000, nav, 0);
    const at = (now: number, playing = true) => checkSleep(t, { now, nav, sentence: 2, playing });
    expect(at(1000 + 9 * 60_000)).toBe('keep');
    expect(at(1000 + 10 * 60_000)).toBe('fire');
    expect(at(1000 + 11 * 60_000, false)).toBe('expire');
  });

  it('fires when reading leaves the current section', () => {
    const t = startSleep({ kind: 'section' }, 0, nav, 3);
    const at = (sentence: number) => checkSleep(t, { now: 0, nav, sentence, playing: true });
    expect([at(3), at(4)]).toEqual(['keep', 'keep']);
    expect(at(5)).toBe('fire');
    expect(checkSleep(t, { now: 0, nav, sentence: 5, playing: false })).toBe('keep');
  });
});
