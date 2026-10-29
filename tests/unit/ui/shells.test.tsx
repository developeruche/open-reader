import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { buildBlock } from '@/core/document/build';
import { memoryStore } from '@/core/util/kv';
import { REGISTRY } from '@/engines/factory';
import { Toaster, TooltipProvider } from '@/ui/components';
import { useMockPlayer } from '@/ui/mock/mockPlayer';
import { createAppearanceStore } from '@/ui/theme';

const models = {
  install: vi.fn(),
  pause: vi.fn(),
  cancel: vi.fn(),
  remove: vi.fn(),
  repair: vi.fn(),
  setDefault: vi.fn(),
  benchmark: vi.fn(),
  refresh: vi.fn(),
};
let modelState: Record<string, unknown> = {};
vi.mock('@/ui/models/useModels', () => ({
  useModels: () => ({
    models: REGISTRY.models,
    installed: {},
    jobs: {},
    report: null,
    benchmarkText: null,
    benchmarking: false,
    voice: null,
    gpu: true,
    ...models,
    ...modelState,
  }),
}));
vi.mock('@/runtime/models', () => ({ playSample: vi.fn(async () => undefined) }));
let sent: unknown[] = [];
let sessionState: Record<string, unknown> = {};
vi.mock('@/ui/session/useSession', () => ({
  useSession: () => ({ ...sessionState, send: (c: unknown) => sent.push(c) }),
}));
vi.mock('@/platform/tabs', () => ({
  openOptions: vi.fn(),
  openReader: vi.fn(),
  targetTabId: async () => 7,
  tabUrl: async () => 'https://example.com/',
  isPdfUrl: (u: string) => u.endsWith('.pdf'),
}));
vi.mock('@/platform/settings', () => ({
  saveSettings: vi.fn(async () => (await import('@/core/settings')).DEFAULT_SETTINGS),
  loadSettings: vi.fn(async () => (await import('@/core/settings')).DEFAULT_SETTINGS),
}));
vi.mock('@/platform/tts', () => ({
  chromeTts: () => ({
    getVoices: async () => [
      { voiceName: 'Samantha', lang: 'en-US', remote: false },
      { voiceName: 'Google US English', lang: 'en-US', remote: true },
    ],
  }),
}));

const { LiveSidePanel } = await import('@/ui/shells/LiveSidePanel');
const { docView } = await import('@/ui/session/docView');
const { OptionsApp } = await import('@/ui/shells/OptionsApp');
const { OnboardingApp } = await import('@/ui/shells/OnboardingApp');
const { GalleryApp } = await import('@/ui/shells/GalleryApp');

const wrap = (ui: React.ReactNode) =>
  render(
    <TooltipProvider>
      {ui}
      <Toaster />
    </TooltipProvider>,
  );
const appearance = () => createAppearanceStore(memoryStore());

beforeEach(() => {
  sent = [];
  location.hash = '';
  useMockPlayer.setState({ status: 'idle', sentence: 0, word: 0, rate: 1, follow: true });
  modelState = {};
  Object.values(models).forEach((f) => f.mockReset());
});

describe('LiveSidePanel', () => {
  it('offers to read the page when nothing is playing', async () => {
    sessionState = {
      session: null,
      doc: null,
      view: null,
      live: { sentenceId: null, word: -1 },
      tabId: 7,
    };
    wrap(<LiveSidePanel useAppearance={appearance()} />);
    await userEvent.click(screen.getByRole('button', { name: 'Read this page' }));
    expect(sent).toContainEqual({ type: 'READ_TAB', tabId: 7 });
  });

  it('drives the session: transport, speed, outline, reader seek and keys', async () => {
    const doc = {
      id: 'd',
      kind: 'web' as const,
      title: 'How a PSBT moves',
      lang: 'en',
      blocks: [
        buildBlock({ id: 'h', type: 'heading', level: 2, text: 'The roles' }),
        buildBlock({ id: 'p', type: 'paragraph', text: 'One sentence here. Two sentences here.' }),
        {
          ...buildBlock({ id: 'r', type: 'reference', text: 'A reference.' }),
          skip: 'reference' as const,
        },
      ],
    };
    const view = docView(doc);
    sessionState = {
      session: {
        sessionId: 's',
        docId: 'd',
        title: doc.title,
        host: 'offscreen',
        url: 'https://ex.test/a',
        state: 'playing',
        cursor: { sentence: 1, part: 0, word: 0 },
        settings: {
          rate: 1,
          voice: 'af_heart',
          pacing: 'natural',
          engineId: 'kokoro',
          modelId: REGISTRY.models[0]!.id,
          backend: 'webgpu',
        },
        sentenceCount: 3,
        hostLost: false,
        error: null,
        updatedAt: 0,
        engine: 'kokoro',
        backend: 'webgpu',
      },
      doc,
      view,
      live: { sentenceId: 'p.0', word: 1 },
      tabId: 7,
    };
    wrap(<LiveSidePanel useAppearance={appearance()} />);
    expect(screen.getByText('On-device · Kokoro · WebGPU')).toBeTruthy();
    expect(screen.getByText('ex.test')).toBeTruthy();
    expect(document.querySelector('[data-current-word]')?.textContent).toBe('sentence');
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    await userEvent.click(screen.getByRole('button', { name: 'Next sentence' }));
    await userEvent.click(screen.getByRole('button', { name: 'Previous sentence' }));
    await userEvent.click(screen.getByText('Two sentences here.', { exact: false }));
    expect(sent).toEqual(
      expect.arrayContaining([
        { type: 'TOGGLE' },
        { type: 'NEXT_SENTENCE' },
        { type: 'PREV_SENTENCE' },
        { type: 'SEEK', sentence: 2 },
      ]),
    );
    await userEvent.click(screen.getByRole('tab', { name: 'Outline' }));
    await userEvent.click(screen.getByRole('button', { name: 'The roles' }));
    expect(sent).toContainEqual({ type: 'SEEK', sentence: 0 });
    await userEvent.click(screen.getByRole('tab', { name: 'Settings' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Follow the voice' }));
    await userEvent.keyboard('k');
    expect(sent).toContainEqual({ type: 'NEXT_SENTENCE' });
    await userEvent.click(screen.getByRole('button', { name: /Voice:/ }));
    await userEvent.click(screen.getByRole('radio', { name: /Emma/ }));
    expect(sent).toContainEqual({ type: 'SET_VOICE', voice: 'bf_emma' });
  });

  it('shows engine errors and retries', async () => {
    const doc = {
      id: 'd',
      kind: 'web' as const,
      title: 'T',
      lang: 'en',
      blocks: [buildBlock({ id: 'p', type: 'paragraph', text: 'Hello there.' })],
    };
    sessionState = {
      session: {
        sessionId: 's',
        docId: 'd',
        title: 'T',
        host: 'offscreen',
        state: 'error',
        cursor: { sentence: 0, part: 0, word: 0 },
        settings: { rate: 1, voice: 'Samantha', pacing: 'natural', engineId: 'system' },
        sentenceCount: 1,
        hostLost: false,
        error: 'The voice could not start.',
        updatedAt: 0,
      },
      doc,
      view: docView(doc),
      live: { sentenceId: null, word: -1 },
      tabId: 7,
    };
    wrap(<LiveSidePanel useAppearance={appearance()} />);
    expect(screen.getByText('The voice could not start.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Play' }));
    expect(sent).toContainEqual({ type: 'RETRY' });
  });
});

describe('OptionsApp', () => {
  it('navigates every section', async () => {
    wrap(<OptionsApp useAppearance={appearance()} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Voices & models' })).toBeTruthy();
    for (const name of [
      'Playback',
      'Reading rules',
      'Pronunciations',
      'Online voices',
      'Shortcuts',
      'Storage',
      'Diagnostics',
      'About & licenses',
    ]) {
      await userEvent.click(screen.getByRole('link', { name }));
      expect(screen.getByRole('heading', { level: 1, name })).toBeTruthy();
    }
    await userEvent.click(screen.getByRole('link', { name: 'Storage' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear audio cache' }));
    await userEvent.click(screen.getByRole('link', { name: 'Online voices' }));
    await userEvent.click(screen.getByRole('switch', { name: 'Use online voices' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Cancel' }));
  });

  it('lists local system voices and hides online ones in strict offline mode', async () => {
    wrap(<OptionsApp useAppearance={appearance()} />);
    expect(await screen.findByText('Samantha', { exact: false })).toBeTruthy();
    expect(screen.queryByText('Google US English', { exact: false })).toBeNull();
    await userEvent.click(screen.getByRole('switch', { name: 'Strict offline' }));
    expect(await screen.findByText('Online')).toBeTruthy();
    await userEvent.click(screen.getAllByRole('button', { name: 'Set as default' }).at(-1)!);
  });

  it('installs models, confirming license notices', async () => {
    wrap(<OptionsApp useAppearance={appearance()} />);
    const items = screen.getAllByRole('listitem').filter((li) => li.getAttribute('data-model'));
    await userEvent.click(within(items[0]!).getByRole('button', { name: 'Install' }));
    expect(models.install).toHaveBeenCalledWith(expect.objectContaining({ engine: 'kokoro' }));
    await userEvent.click(within(items[1]!).getByRole('button', { name: 'Install' }));
    await userEvent.click(await screen.findByRole('button', { name: 'Install for personal use' }));
    expect(models.install).toHaveBeenCalledTimes(2);
  });

  it('shows download progress and installed actions', async () => {
    const kokoro = REGISTRY.models[0]!;
    modelState = {
      installed: {
        [kokoro.id]: {
          modelId: kokoro.id,
          version: kokoro.version,
          backend: 'webgpu',
          files: [],
          installedAt: 0,
        },
      },
      jobs: {
        [REGISTRY.models[1]!.id]: { state: 'downloading', loaded: 5e6, total: 1e8 },
        [REGISTRY.models[2]!.id]: { state: 'error', loaded: 0, total: 1, error: 'Offline.' },
      },
      voice: { engineId: 'kokoro', modelId: kokoro.id, voice: 'af_heart' },
      benchmarkText: 'Kokoro · WebGPU · 9.4× real time',
    };
    wrap(<OptionsApp useAppearance={appearance()} />);
    expect(screen.getByText(/Benchmark: Kokoro/)).toBeTruthy();
    expect(screen.getByText('Default')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(models.pause).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Cancel' })[0]!);
    await userEvent.click(screen.getByRole('button', { name: 'Repair' }));
    await userEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await userEvent.click(screen.getByRole('button', { name: 'Emma' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run benchmark' }));
    expect(models.repair).toHaveBeenCalled();
    expect(models.remove).toHaveBeenCalled();
    expect(models.setDefault).toHaveBeenCalledWith(kokoro, 'bf_emma');
    expect(models.benchmark).toHaveBeenCalled();
  });
});

describe('OnboardingApp', () => {
  it('walks through download, benchmark, voice and shortcuts', async () => {
    wrap(<OnboardingApp />);
    await userEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await userEvent.click(screen.getByRole('button', { name: 'Download' }));
    expect(models.install).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Continue' }).hasAttribute('disabled')).toBe(true);
  });

  it('continues once installed and plays samples', async () => {
    const kokoro = REGISTRY.models[0]!;
    modelState = {
      installed: {
        [kokoro.id]: {
          modelId: kokoro.id,
          version: kokoro.version,
          backend: 'wasm',
          files: [],
          installedAt: 0,
        },
      },
    };
    wrap(<OnboardingApp />);
    await userEvent.click(screen.getByRole('button', { name: 'Get started' }));
    expect(screen.getByText('Downloaded and verified.')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Run the check' }));
    expect(models.benchmark).toHaveBeenCalled();
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Play sample of Emma' }));
    await userEvent.click(screen.getByRole('radio', { name: /George/ }));
    expect(models.setDefault).toHaveBeenCalledWith(kokoro, 'bm_george');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Three keys to remember' })).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(screen.getByRole('heading', { name: 'Ready' })).toBeTruthy();
  });

  it('shows paused and failed downloads with a way to continue', async () => {
    const kokoro = REGISTRY.models[0]!;
    modelState = { jobs: { [kokoro.id]: { state: 'paused', loaded: 1, total: 2 } } };
    const { unmount } = wrap(<OnboardingApp />);
    await userEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await userEvent.click(screen.getByRole('button', { name: 'Resume' }));
    unmount();
    modelState = { jobs: { [kokoro.id]: { state: 'downloading', loaded: 1, total: 2 } } };
    wrap(<OnboardingApp />);
    await userEvent.click(screen.getByRole('button', { name: 'Get started' }));
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(models.pause).toHaveBeenCalled();
  });
});

describe('GalleryApp', () => {
  it('renders components and the mini player', async () => {
    wrap(<GalleryApp />);
    await userEvent.click(screen.getByRole('button', { name: 'Show error toast' }));
    expect(await screen.findByText('WebGPU failed')).toBeTruthy();
    await userEvent.click(screen.getByRole('button', { name: 'Open dialog' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
  });
});
