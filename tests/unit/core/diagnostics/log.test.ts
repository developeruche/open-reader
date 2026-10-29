import { describe, expect, it } from 'vitest';
import { DiagLog, redactSecrets } from '@/core/diagnostics/log';

describe('DiagLog', () => {
  it('keeps the newest entries up to its capacity and clips long messages', () => {
    const log = new DiagLog(3);
    for (let i = 0; i < 5; i++) log.push({ at: i, level: 'info', source: 't', message: `m${i}` });
    expect(log.entries().map((e) => e.message)).toEqual(['m2', 'm3', 'm4']);
    expect(log.droppedCount).toBe(2);
    log.push({
      at: 9,
      level: 'error',
      source: 't',
      message: 'x'.repeat(400),
      detail: 'y'.repeat(400),
    });
    const last = log.entries().at(-1);
    expect(last?.message).toHaveLength(300);
    expect(last?.message.endsWith('…')).toBe(true);
    expect(last?.detail).toHaveLength(300);
    log.clear();
    expect(log.entries()).toEqual([]);
    expect(log.droppedCount).toBe(0);
  });

  it('redacts secrets from exported objects', () => {
    expect(
      redactSecrets({ apiKey: 'sk-1', nested: { token: 't', count: 2 }, voice: 'af_heart' }),
    ).toEqual({
      apiKey: '[redacted]',
      nested: { token: '[redacted]', count: 2 },
      voice: 'af_heart',
    });
  });
});
