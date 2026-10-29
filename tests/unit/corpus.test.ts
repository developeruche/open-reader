import { describe, expect, it } from 'vitest';
import passages from '../fixtures/corpus/passages.json';
import { corpus } from '../../scripts/corpus';

describe('corpus', () => {
  it('is deterministic, unique and 200 sentences long', () => {
    const a = corpus();
    expect(a).toHaveLength(200);
    expect(new Set(a).size).toBe(200);
    expect(corpus()).toEqual(a);
  });
  it('has ten reference passages', () => {
    expect(passages.passages).toHaveLength(10);
  });
});
