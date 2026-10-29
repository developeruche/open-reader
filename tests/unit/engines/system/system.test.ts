import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlock } from '@/core/document/build';
import type { BackendEvent } from '@/core/player/backend';
import { Player } from '@/core/player/player';
import type { SyncEvent } from '@/core/player/sync';
import { SystemEngine } from '@/engines/system/engine';
import { LiveBackend } from '@/engines/system/liveBackend';
import { RemoteTts } from '@/engines/system/remoteTts';
import type { TtsApi, TtsEvent, TtsSpeakOptions } from '@/engines/system/tts';
import type { HostEvent } from '@/runtime/protocol';

/** A fake chrome.tts that "speaks" 50 ms per character / rate, with word events. */
class FakeTts implements TtsApi {
  spoken: { text: string; opts: TtsSpeakOptions }[] = [];
  ops: string[] = [];
  private timers: ReturnType<typeof setTimeout>[] = [];
  speak(text: string, opts: TtsSpeakOptions, on: (e: TtsEvent) => void) {
    this.spoken.push({ text, opts });
    const per = 50 / opts.rate;
    this.timers.push(setTimeout(() => on({ type: 'start' }), 0));
    for (const m of text.matchAll(/\S+/g))
      this.timers.push(setTimeout(() => on({ type: 'word', charIndex: m.index }), m.index * per));
    this.timers.push(setTimeout(() => on({ type: 'end' }), text.length * per));
  }
  pause() {
    // Like chrome.tts, a paused utterance emits nothing until resumed.
    this.ops.push('pause');
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
  resume() {
    this.ops.push('resume');
  }
  stop() {
    this.ops.push('stop');
    this.timers.forEach(clearTimeout);
    this.timers = [];
  }
  async getVoices() {
    return [
      { voiceName: 'Samantha', lang: 'en-US', remote: false },
      { voiceName: 'Google US English', lang: 'en-US', remote: true },
    ];
  }
}

const audio = (text: string) => {
  const words = [...text.matchAll(/\S+/g)].map((m) => ({
    charStart: m.index,
    charEnd: m.index + m[0].length,
    start: m.index * 0.05,
    end: (m.index + m[0].length) * 0.05,
  }));
  return {
    pcm: new Float32Array(0),
    sampleRate: 24000,
    words,
    duration: text.length * 0.05 + 0.2,
    speechEnd: text.length * 0.05,
    utterance: { text, voice: 'Samantha', lang: 'en' },
  };
};

describe('LiveBackend', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }));
  afterEach(() => vi.useRealTimers());

  it('speaks, re-anchors on word events and ends after the structural pause', async () => {
    const tts = new FakeTts();
    const b = new LiveBackend(tts);
    const events: BackendEvent[] = [];
    b.subscribe((e) => events.push(e));
    b.play(audio('One two three'), { rate: 1 });
    expect(b.audibleCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(300);
    expect(events[0]).toMatchObject({ type: 'started', mediaTime: 0 });
    expect(
      events
        .filter((e) => e.type === 'progress')
        .map((e) => (e.type === 'progress' ? e.mediaTime : 0)),
    ).toEqual([0, 0.2]);
    expect(b.mediaTime()).toBeGreaterThan(0.2);
    await vi.advanceTimersByTimeAsync(400 + 200);
    expect(events.at(-1)).toEqual({ type: 'ended' });
    expect(b.audibleCount()).toBe(0);
    expect(tts.spoken[0]!.opts).toMatchObject({ voiceName: 'Samantha', rate: 1 });
  });

  it('pauses, resumes, restarts at the current word on rate change and starts from an offset', async () => {
    const tts = new FakeTts();
    const b = new LiveBackend(tts);
    b.play(audio('alpha beta gamma delta'), { rate: 1 });
    await vi.advanceTimersByTimeAsync(320);
    b.pause();
    const t = b.mediaTime();
    await vi.advanceTimersByTimeAsync(1000);
    expect(b.mediaTime()).toBe(t);
    b.resume();
    expect(tts.ops).toEqual(['pause', 'resume']);
    b.setRate(2);
    expect(tts.spoken.at(-1)).toMatchObject({ text: 'beta gamma delta', opts: { rate: 2 } });
    b.setRate(2); // no-op
    b.play(audio('alpha beta gamma delta'), { rate: 1, offset: 0.6 });
    expect(tts.spoken.at(-1)!.text).toBe('gamma delta');
    b.stop();
    expect(b.audibleCount()).toBe(0);
  });

  it('reports errors and missing utterances', async () => {
    const tts: TtsApi = {
      ...new FakeTts(),
      speak: (_t, _o, on) => setTimeout(() => on({ type: 'error', errorMessage: 'no voice' }), 0),
      stop: () => undefined,
      pause: () => undefined,
      resume: () => undefined,
      getVoices: async () => [],
    };
    const b = new LiveBackend(tts);
    const events: BackendEvent[] = [];
    b.subscribe((e) => events.push(e));
    b.play(audio('x'), { rate: 1 });
    await vi.advanceTimersByTimeAsync(5);
    b.play({ ...audio('x'), utterance: undefined }, { rate: 1 });
    expect(events.map((e) => e.type)).toEqual(['error', 'error']);
    b.preload();
  });
});

describe('RemoteTts and SystemEngine', () => {
  it('forwards ops and delivers only the latest utterance events', () => {
    const posted: HostEvent[] = [];
    const r = new RemoteTts((e) => posted.push(e));
    const seen: string[] = [];
    r.speak('a', { rate: 1 }, (e) => seen.push(`1:${e.type}`));
    r.speak('b', { rate: 1 }, (e) => seen.push(`2:${e.type}`));
    r.deliver(1, { type: 'word' });
    r.deliver(2, { type: 'end' });
    r.pause();
    r.resume();
    r.stop();
    expect(seen).toEqual(['2:end']);
    expect(posted.map((p) => (p.type === 'TTS' ? p.op : ''))).toEqual([
      'speak',
      'speak',
      'pause',
      'resume',
      'stop',
    ]);
  });

  it('lists voices, labels online ones and refuses to render', async () => {
    const e = new SystemEngine(new FakeTts());
    expect(await e.init({} as never, { backend: 'auto' })).toEqual({ backend: 'system' });
    expect((await e.voices()).map((v) => v.name)).toEqual([
      'Samantha',
      'Google US English (online)',
    ]);
    await expect(e.synthesize()).rejects.toThrow('live');
    await e.dispose();
    expect(e.caps.live).toBe(true);
    await expect(new RemoteTts(() => undefined).getVoices()).resolves.toEqual([]);
  });
});

describe('Player with a live engine', () => {
  beforeEach(() =>
    vi.useFakeTimers({
      toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
    }),
  );
  afterEach(() => vi.useRealTimers());

  it('plans utterances, follows word events and reads to the end', async () => {
    const tts = new FakeTts();
    const sync: SyncEvent[] = [];
    const player = new Player({
      doc: {
        id: 'd',
        kind: 'web',
        title: '',
        lang: 'en',
        blocks: [
          buildBlock({
            id: 'p',
            type: 'paragraph',
            text: 'A PSBT is a container. Wallets cooperate.',
          }),
        ],
      },
      engine: new SystemEngine(tts),
      model: { modelId: 'system', version: '1' },
      backend: new LiveBackend(tts),
      sessionId: 's',
      settings: { voice: 'Samantha', rate: 1.5 },
      onSync: (e) => sync.push(e),
    });
    player.send({ type: 'PLAY' });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(player.state).toBe('ended');
    expect(tts.spoken.map((s) => s.text)).toEqual([
      'A P S B T is a container.',
      'Wallets cooperate.',
    ]);
    expect(tts.spoken[0]!.opts.rate).toBe(1.5);
    expect(sync.some((e) => e.type === 'DRIFT')).toBe(true);
    const started = sync.find((e) => e.type === 'SEGMENT_STARTED');
    expect(started?.type === 'SEGMENT_STARTED' && started.words.length).toBeGreaterThan(3);
    player.dispose();
  });
});
