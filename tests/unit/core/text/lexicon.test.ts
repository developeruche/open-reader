import { describe, expect, it } from 'vitest';

describe('stored pronunciations', () => {
  it('compiles user entries, drops bad regular expressions, and respects packs', async () => {
    const { compileEntries, lexiconFrom, LexiconFileSchema } = await import('@/core/text/lexicon');
    const entries = compileEntries([
      { id: '1', match: 'Schnorr', say: 'shnor' },
      { id: '2', match: 'v(\\d+)', say: 'version $1', regex: true },
      { id: '3', match: '([', say: 'x', regex: true },
      { id: '4', match: 'nonce', say: 'nonss', engines: ['piper'], caseSensitive: true },
    ]);
    expect(entries.map((e) => String(e.match))).toEqual(['Schnorr', '/v(\\d+)/iu', 'nonce']);
    expect(entries[2]).toMatchObject({ engines: ['piper'], caseSensitive: true });
    const lex = lexiconFrom(
      { user: [{ id: '1', match: 'Schnorr', say: 'shnor' }], packs: [] },
      'kokoro',
    );
    expect(lex.apply('Schnorr and PSBT').spoken).toBe('shnor and PSBT');
    const withPack = lexiconFrom({ user: [], packs: ['bitcoin'] }, 'kokoro');
    expect(withPack.apply('PSBT').spoken).toBe('P S B T');
    expect(lexiconFrom(undefined, 'kokoro').apply('npm').spoken).toBe('N P M');
    expect(
      LexiconFileSchema.safeParse({
        format: 'open-reader-lexicon',
        version: 1,
        entries: [{ match: 'a', say: 'b' }],
      }).success,
    ).toBe(true);
    expect(LexiconFileSchema.safeParse({ entries: [] }).success).toBe(false);
  });
});

describe('serialized engine', () => {
  it('runs synthesize calls one at a time and skips aborted ones', async () => {
    const { serialized } = await import('@/core/tts/engine');
    const { TestEngine } = await import('@/engines/test/engine');
    const inner = new TestEngine({ delayMs: 5 });
    let running = 0;
    let max = 0;
    const orig = inner.synthesize.bind(inner);
    inner.synthesize = async (req, signal) => {
      running++;
      max = Math.max(max, running);
      try {
        return await orig(req, signal);
      } finally {
        running--;
      }
    };
    const e = serialized(inner);
    const ac = new AbortController();
    const req = { text: 'Hi.', voiceId: 'test', speed: 1, lang: 'en' };
    const a = e.synthesize(req);
    const b = e.synthesize(req, ac.signal);
    ac.abort();
    const c = e.synthesize(req);
    await expect(a).resolves.toBeDefined();
    await expect(b).rejects.toMatchObject({ name: 'AbortError' });
    await expect(c).resolves.toBeDefined();
    expect(max).toBe(1);
    expect(e.id).toBe('test');
  });
});
