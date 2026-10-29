import { describe, expect, it } from 'vitest';
import { buildBlock } from '@/core/document/build';
import { docView, secondsLeft } from '@/ui/session/docView';

describe('docView', () => {
  it('maps view sentences to player sentences and keeps skipped blocks muted', () => {
    const doc = {
      id: 'd',
      kind: 'web' as const,
      title: 'T',
      lang: 'en',
      blocks: [
        buildBlock({ id: 'h', type: 'heading', level: 1, text: 'Title' }),
        { ...buildBlock({ id: 'c', type: 'code', text: 'npm i' }), skip: 'code' as const },
        {
          ...buildBlock({ id: 'r', type: 'reference', text: 'Ref one.' }),
          skip: 'reference' as const,
        },
        buildBlock({ id: 'p', type: 'paragraph', text: 'One here. Two here.' }),
      ],
    };
    const v = docView(doc, true);
    expect(v.toPlayer).toEqual([0, 1, -1, 2, 3]);
    expect(v.blocks.map((b) => b.muted)).toEqual([false, false, true, false]);
    expect(v.blocks[3]!.sentences[1]!.words).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 8 },
    ]);
    expect(v.viewIndexOf.get('p.1')).toBe(4);
    expect(secondsLeft(v, 0, 1)).toBeGreaterThan(secondsLeft(v, 3, 1));
    expect(secondsLeft(v, 0, 2)).toBeCloseTo(secondsLeft(v, 0, 1) / 2);
    const quiet = docView(doc, false);
    expect(quiet.toPlayer).toEqual([0, -1, -1, 1, 2]);
  });
});
