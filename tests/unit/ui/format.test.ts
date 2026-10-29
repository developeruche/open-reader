import { describe, expect, it } from 'vitest';
import { formatBytes, formatRate, formatTimeLeft } from '@/ui/format';

describe('formatRate', () => {
  it.each([
    [1, '1.0×'],
    [2, '2.0×'],
    [1.25, '1.25×'],
    [1.5, '1.5×'],
    [0.75, '0.75×'],
    [1.3333, '1.33×'],
  ])('%s → %s', (rate, text) => expect(formatRate(rate)).toBe(text));
});

describe('formatTimeLeft', () => {
  it.each([
    [0, '0 s left'],
    [45.4, '45 s left'],
    [61, '1 min left'],
    [8 * 60, '8 min left'],
    [65 * 60, '1 h 5 min left'],
    [-3, '0 s left'],
  ])('%s s → %s', (s, text) => expect(formatTimeLeft(s)).toBe(text));
});

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [999, '999 B'],
    [1500, '1.5 KB'],
    [68e6, '68 MB'],
    [123.4e6, '123 MB'],
    [262e9, '262 GB'],
  ])('%d → %s', (b, s) => expect(formatBytes(b)).toBe(s.replace(' ', '\u00a0')));
});
