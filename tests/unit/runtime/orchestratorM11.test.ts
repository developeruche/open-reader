import { describe, expect, it } from 'vitest';
import { buildBlock } from '@/core/document/build';
import type { ReadingDocument } from '@/core/document/model';
import { DEFAULT_SKIP_RULES, type SkipRules } from '@/core/text/skip';
import { Orchestrator } from '@/runtime/orchestrator';
import {
  DEFAULT_SESSION_SETTINGS,
  type HostCommand,
  type HostStatus,
  type SessionInfo,
  type UiUpdate,
} from '@/runtime/protocol';

const raw: ReadingDocument = {
  id: 'd1',
  kind: 'web',
  title: 'Doc',
  lang: 'en',
  blocks: [
    buildBlock({ id: 'h1', type: 'heading', level: 1, text: 'One' }),
    buildBlock({ id: 'p1', type: 'paragraph', text: 'First. Second.' }),
    buildBlock({ id: 'c', type: 'code', text: 'npm install' }),
    buildBlock({ id: 'h2', type: 'heading', level: 1, text: 'Two' }),
    buildBlock({ id: 'p2', type: 'paragraph', text: 'Third. Fourth.' }),
  ],
};

function harness() {
  let now = 1_000;
  let stored: SessionInfo | null = null;
  const docs = new Map<string, ReadingDocument>();
  const rules = new Map<string, SkipRules>();
  const sent: HostCommand[] = [];
  const ui: UiUpdate[] = [];
  const downloads: [string, string][] = [];
  let failDownload = false;
  const orch = new Orchestrator({
    store: {
      loadSession: async () => stored,
      saveSession: async (s) => void (stored = s),
      saveDoc: async (d) => void docs.set(d.id, d),
      loadDoc: async (id) => docs.get(id),
    },
    library: {
      savePosition: async () => undefined,
      getPosition: async () => undefined,
      getRules: async (id) => rules.get(id),
      saveRules: async (id, r) => void (r ? rules.set(id, r) : rules.delete(id)),
    },
    offscreen: { ensure: async () => undefined, exists: async () => true },
    ui: { broadcast: (u) => ui.push(u) },
    content: { send: () => undefined, extract: async () => undefined },
    settings: async () => ({
      ...DEFAULT_SESSION_SETTINGS,
      skipRules: DEFAULT_SKIP_RULES,
      lexicon: { user: [{ id: 'x', match: 'npm', say: 'en pee em' }], packs: [] },
    }),
    activeTabId: async () => 7,
    now: () => now,
    newId: () => `id${sent.length}`,
    download: async (url, filename) => {
      if (failDownload) throw new Error('The download failed (disk full).');
      downloads.push([url, filename]);
    },
  });
  orch.hostConnected('offscreen', { send: (c) => void sent.push(c) });
  const status = (sentence: number, state: HostStatus['state'] = 'playing'): HostStatus => ({
    sessionId: orch.session?.sessionId ?? '',
    state,
    cursor: { sentence, part: 0, word: 0 },
    rate: 1,
    voice: 'test',
    sentenceCount: 4,
    error: null,
    audible: 1,
  });
  return {
    orch,
    sent,
    ui,
    downloads,
    rules,
    status,
    docs,
    tick: (ms: number) => (now += ms),
    failDownloads: () => (failDownload = true),
    async start() {
      await orch.hostEvent('offscreen', { type: 'HELLO', host: 'offscreen', status: null });
      await orch.contentDoc(7, raw, 'https://x.test/a', undefined);
    },
  };
}

const notices = (ui: UiUpdate[]) =>
  ui.flatMap((u) => (u.type === 'NOTICE' ? [u.notice.message] : []));

describe('Orchestrator: sleep timer', () => {
  it('pauses at the first sentence boundary after the minutes run out', async () => {
    const h = harness();
    await h.start();
    await h.orch.command({ type: 'SET_SLEEP', sleep: { kind: 'minutes', minutes: 1 } });
    expect(h.orch.session?.sleep).toEqual({ kind: 'minutes', at: 1_000 + 60_000 });
    await h.orch.hostEvent('offscreen', { type: 'STATUS', status: h.status(1) });
    expect(h.sent.some((c) => c.type === 'PLAYER' && c.event.type === 'SLEEP_TIMER_FIRED')).toBe(
      false,
    );
    h.tick(61_000);
    await h.orch.hostEvent('offscreen', { type: 'STATUS', status: h.status(2) });
    expect(h.sent.at(-1)).toMatchObject({ type: 'PLAYER', event: { type: 'SLEEP_TIMER_FIRED' } });
    expect(h.orch.session?.sleep).toBeNull();
    expect(notices(h.ui)).toContain('Sleep timer: reading paused.');
  });

  it('pauses when reading reaches the next section, and can be turned off', async () => {
    const h = harness();
    await h.start();
    await h.orch.command({ type: 'SET_SLEEP', sleep: { kind: 'section' } });
    await h.orch.hostEvent('offscreen', { type: 'STATUS', status: h.status(2) });
    expect(h.orch.session?.sleep).not.toBeNull();
    // Sentences: heading One (0), First (1), Second (2), code announcement (3), heading Two (4).
    await h.orch.hostEvent('offscreen', { type: 'STATUS', status: h.status(4) });
    expect(h.sent.at(-1)).toMatchObject({ event: { type: 'SLEEP_TIMER_FIRED' } });
    await h.orch.command({ type: 'SET_SLEEP', sleep: { kind: 'minutes', minutes: 5 } });
    await h.orch.command({ type: 'SET_SLEEP', sleep: null });
    expect(h.orch.session?.sleep).toBeNull();
  });
});

describe('Orchestrator: rules for one document', () => {
  it('re-reads the page with its own rules at the same sentence and remembers them', async () => {
    const h = harness();
    await h.start();
    expect(h.orch.session?.sentenceCount).toBe(7); // code block announced, not read
    // At "Third." (sentence 5), read code blocks aloud for this page.
    await h.orch.hostEvent('offscreen', { type: 'STATUS', status: h.status(5) });
    const custom = { ...DEFAULT_SKIP_RULES, codeBlocks: 'read' as const };
    await h.orch.command({ type: 'SET_DOC_RULES', rules: custom });
    expect(h.rules.get('d1')).toEqual(custom);
    const load = h.sent.findLast((c) => c.type === 'LOAD');
    expect(load).toMatchObject({
      start: { sentence: 5 },
      autoplay: true,
      settings: { skipRules: custom },
    });
    expect(h.orch.session?.docRules).toEqual(custom);
    expect(h.docs.get('d1')?.blocks.find((b) => b.id === 'c')?.skip).toBeUndefined();
    // Reopening the page uses the remembered rules.
    await h.orch.contentDoc(7, raw, 'https://x.test/a', undefined);
    expect(h.orch.session?.docRules).toEqual(custom);
    await h.orch.command({ type: 'SET_DOC_RULES', rules: null });
    expect(h.rules.has('d1')).toBe(false);
    expect(h.orch.session?.docRules).toBeNull();
  });
});

describe('Orchestrator: audiobook export', () => {
  it('starts the job in the host, saves the file when done, then releases it', async () => {
    const h = harness();
    await h.start();
    await h.orch.command({ type: 'EXPORT', format: 'mp3' });
    const cmd = h.sent.findLast((c) => c.type === 'EXPORT');
    expect(cmd).toMatchObject({ type: 'EXPORT', format: 'mp3' });
    const jobId = cmd?.type === 'EXPORT' ? cmd.jobId : '';
    expect(h.orch.session?.exportJob).toMatchObject({ jobId, state: 'running' });
    await h.orch.hostEvent('offscreen', {
      type: 'EXPORT',
      status: { jobId, format: 'mp3', state: 'running', phase: 'render', fraction: 0.5 },
    });
    expect(h.orch.session?.exportJob?.fraction).toBe(0.5);
    await h.orch.command({ type: 'EXPORT_CANCEL' });
    expect(h.sent.at(-1)).toEqual({ type: 'EXPORT_CANCEL', jobId });
    await h.orch.hostEvent('offscreen', {
      type: 'EXPORT',
      status: {
        jobId,
        format: 'mp3',
        state: 'done',
        phase: 'encode',
        fraction: 1,
        filename: 'Doc.mp3',
      },
      url: 'blob:x',
    });
    expect(h.downloads).toEqual([['blob:x', 'Doc.mp3']]);
    expect(h.sent.at(-1)).toEqual({ type: 'EXPORT_RELEASE', jobId });
    expect(notices(h.ui)).toContain('Saved “Doc.mp3” to Downloads.');
    // Events for other jobs are ignored.
    await h.orch.hostEvent('offscreen', {
      type: 'EXPORT',
      status: { jobId: 'other', format: 'mp3', state: 'error', phase: 'render', fraction: 0 },
    });
    expect(h.orch.session?.exportJob?.state).toBe('done');
  });

  it('reports a failed download and still releases the file', async () => {
    const h = harness();
    await h.start();
    h.failDownloads();
    await h.orch.command({ type: 'EXPORT', format: 'wav' });
    const cmd = h.sent.findLast((c) => c.type === 'EXPORT');
    const jobId = cmd?.type === 'EXPORT' ? cmd.jobId : '';
    await h.orch.hostEvent('offscreen', {
      type: 'EXPORT',
      status: {
        jobId,
        format: 'wav',
        state: 'done',
        phase: 'encode',
        fraction: 1,
        filename: 'Doc.wav',
      },
      url: 'blob:y',
    });
    expect(h.orch.session?.exportJob).toMatchObject({
      state: 'error',
      message: 'The download failed (disk full).',
    });
    expect(h.sent.at(-1)).toEqual({ type: 'EXPORT_RELEASE', jobId });
  });
});

describe('Orchestrator: pronunciations', () => {
  it('sends the new lexicon to the host when settings change', async () => {
    const h = harness();
    await h.start();
    await h.orch.command({ type: 'SETTINGS_CHANGED' });
    expect(h.sent.at(-1)).toMatchObject({
      type: 'SET_LEXICON',
      lexicon: { user: [{ match: 'npm' }], packs: [] },
    });
  });
});

describe('Orchestrator: sleep timer across segment boundaries', () => {
  it('waits through buffering and fires on the next playing status', async () => {
    const h = harness();
    await h.start();
    await h.orch.command({ type: 'SET_SLEEP', sleep: { kind: 'minutes', minutes: 1 } });
    h.tick(61_000);
    await h.orch.hostEvent('offscreen', { type: 'STATUS', status: h.status(2, 'buffering') });
    expect(h.orch.session?.sleep).not.toBeNull();
    await h.orch.hostEvent('offscreen', { type: 'STATUS', status: h.status(2, 'playing') });
    expect(h.sent.at(-1)).toMatchObject({ event: { type: 'SLEEP_TIMER_FIRED' } });
  });
});
